import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as auditModule from "@/graph/audit";
import { type AuditOperation, writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

describe("audit log write layer", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// writeAuditEntry succeeds for every operation type
	// ---------------------------------------------------------------

	const allOps: AuditOperation[] = [
		"ADD",
		"UPDATE",
		"INVALIDATE",
		"NOOP",
		"STAGE",
		"PROMOTE",
		"QUARANTINE",
		"SYNC_RECV",
		"SYNC_SEND",
		"ARCHIVE",
		"VSS_REFRESH",
	];

	for (const op of allOps) {
		it(`writeAuditEntry succeeds for operation '${op}'`, async () => {
			tmpDir = makeTmp();
			db = openGraphDb(`audit-op-${op}`, tmpDir);

			await writeAuditEntry(db, op, { entity_id: `ent-${op}` });

			const result = await db.execute(
				"SELECT operation, entity_id FROM audit_log WHERE operation = ?",
				[op],
			);
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0]?.operation).toBe(op);
			expect(result.rows[0]?.entity_id).toBe(`ent-${op}`);
		});
	}

	// ---------------------------------------------------------------
	// 1000 sequential writes succeed
	// ---------------------------------------------------------------

	it("1000 sequential writes succeed", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("audit-bulk", tmpDir);

		for (let i = 0; i < 1000; i++) {
			await writeAuditEntry(db, "ADD", { entity_id: `ent-${i}` });
		}

		const result = await db.execute("SELECT COUNT(*) as cnt FROM audit_log");
		expect(result.rows[0]?.cnt).toBe(1000);
	});

	// ---------------------------------------------------------------
	// No update or delete method exported
	// ---------------------------------------------------------------

	it("module exports only writeAuditEntry as a function", () => {
		const exportedKeys = Object.keys(auditModule);
		const exportedFunctions = exportedKeys.filter(
			(k) => typeof (auditModule as Record<string, unknown>)[k] === "function",
		);
		expect(exportedFunctions).toEqual(["writeAuditEntry"]);
	});

	// ---------------------------------------------------------------
	// writeAuditEntry does not throw on DB error
	// ---------------------------------------------------------------

	it("does not throw when DB is closed", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("audit-closed", tmpDir);
		await db.close();

		// Should not throw — errors are caught internally.
		await expect(writeAuditEntry(db, "ADD", { entity_id: "x" })).resolves.toBeUndefined();

		// Prevent afterEach from closing again.
		db = undefined;
	});

	// ---------------------------------------------------------------
	// Written entries are retrievable via db.execute SELECT
	// ---------------------------------------------------------------

	it("written entries are retrievable via SELECT", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("audit-select", tmpDir);

		await writeAuditEntry(db, "STAGE", {
			entity_id: "ent-stage-1",
			trust_tier: 4,
			extraction_method: "llm-haiku",
			developer_id: "dev-42",
			source_hash: "abc123",
			snapshot_id: "snap-1",
			edge_id: "edge-99",
			source_episode: "ep-7",
		});

		const result = await db.execute("SELECT * FROM audit_log WHERE entity_id = ?", ["ent-stage-1"]);
		expect(result.rows).toHaveLength(1);

		const row = result.rows[0] as Record<string, unknown>;
		expect(row.id).toBeDefined();
		expect(typeof row.ts).toBe("number");
		expect(row.operation).toBe("STAGE");
		expect(row.entity_id).toBe("ent-stage-1");
		expect(row.edge_id).toBe("edge-99");
		expect(row.source_episode).toBe("ep-7");
		expect(row.trust_tier).toBe(4);
		expect(row.extraction_method).toBe("llm-haiku");
		expect(row.source_hash).toBe("abc123");
		expect(row.developer_id).toBe("dev-42");
		expect(row.snapshot_id).toBe("snap-1");
	});
});
