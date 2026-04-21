import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { v4 as uuid } from "uuid";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleNousCuriosity } from "@/mcp/tools/nous-curiosity";

function makeTmp(): string {
	return join(tmpdir(), `nous-cu-${randomUUID()}`);
}

/** Test helper: insert a minimal graph_nodes row. */
function insertNode(
	db: SiaDb,
	opts: {
		id: string;
		type: string;
		name: string;
		trust_tier: number;
		access_count: number;
		kind?: string | null;
	},
): void {
	const raw = db.rawSqlite();
	if (!raw) throw new Error("no raw sqlite handle");
	const now = Date.now();
	raw.prepare(
		`INSERT INTO graph_nodes (
			id, type, name, content, summary,
			tags, file_paths,
			trust_tier, confidence, base_confidence,
			importance, base_importance,
			access_count, edge_count,
			last_accessed, created_at, t_created,
			visibility, created_by,
			kind
		) VALUES (?, ?, ?, 'content', 'summary', '[]', '[]', ?, 0.9, 0.9, 0.5, 0.5, ?, 0, ?, ?, ?, 'private', 'test', ?)`,
	).run(
		opts.id,
		opts.type,
		opts.name,
		opts.trust_tier,
		opts.access_count,
		now,
		now,
		now,
		opts.kind ?? null,
	);
}

describe("nous-curiosity", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	it("returns empty clusters when no high-trust low-access entities exist", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-cu1", tmpDir);

		const result = await handleNousCuriosity(db, "cu-sess-1", {});
		expect(Array.isArray(result.clusters)).toBe(true);
		expect(result.clusters.length).toBe(0);
		expect(result.concernsWritten).toBe(0);
	});

	it("finds high-trust entities with low access count", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-cu2", tmpDir);

		insertNode(db, {
			id: uuid(),
			type: "Decision",
			name: "Unexplored Decision",
			trust_tier: 1,
			access_count: 0,
			kind: "Decision",
		});

		const result = await handleNousCuriosity(db, "cu-sess-2", { depth: 1 });
		expect(result.clusters.length).toBeGreaterThan(0);
		expect(result.clusters[0].name).toBeDefined();
		// Concern should be written for the top cluster.
		expect(result.concernsWritten).toBeGreaterThan(0);

		// Verify the Concern node has status:open tag.
		const raw = db.rawSqlite();
		const concernRow = raw!
			.prepare("SELECT tags FROM graph_nodes WHERE kind = 'Concern'")
			.get() as { tags: string } | undefined;
		expect(concernRow?.tags).toContain("status:open");
	});

	it("excludes Episode/Signal/Concern/Preference kinds from exploration", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-cu3", tmpDir);

		insertNode(db, {
			id: uuid(),
			type: "Signal",
			name: "Signal node",
			trust_tier: 1,
			access_count: 0,
			kind: "Signal",
		});
		insertNode(db, {
			id: uuid(),
			type: "Preference",
			name: "Preference node",
			trust_tier: 1,
			access_count: 0,
			kind: "Preference",
		});

		const result = await handleNousCuriosity(db, "cu-sess-3", {});
		expect(result.clusters.length).toBe(0);
	});
});
