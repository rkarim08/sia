import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { consolidationSweepBatch, runConsolidationSweep } from "@/decay/consolidation-sweep";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("consolidation sweep", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

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
	// detects near-duplicate pairs and writes 'merged' to local_dedup_log
	// ---------------------------------------------------------------

	it("detects near-duplicate pairs and writes 'merged' to local_dedup_log", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sweep-merged", tmpDir);

		// Insert 2 entities of same type with nearly identical content (Jaccard > 0.92)
		// 20 unique words, add 1 extra → Jaccard = 20/21 ≈ 0.952
		await insertEntity(db, {
			type: "Concept",
			name: "Entity A",
			content:
				"alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango",
			summary: "Near dup A",
		});
		await insertEntity(db, {
			type: "Concept",
			name: "Entity B",
			content:
				"alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform",
			summary: "Near dup B",
		});

		const processed = await runConsolidationSweep(db);
		expect(processed).toBe(1);

		const { rows } = await db.execute("SELECT * FROM local_dedup_log WHERE decision = 'merged'");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.decision).toBe("merged");
	});

	// ---------------------------------------------------------------
	// writes 'related' for moderate similarity
	// ---------------------------------------------------------------

	it("writes 'related' for moderate similarity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sweep-related", tmpDir);

		// Insert 2 entities of same type with ~60% content overlap
		// 10 shared words out of 16 total unique → Jaccard = 10/16 = 0.625
		await insertEntity(db, {
			type: "Decision",
			name: "Entity A",
			content: "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike",
			summary: "TS decision A",
		});
		await insertEntity(db, {
			type: "Decision",
			name: "Entity B",
			content: "alpha bravo charlie delta echo foxtrot golf hotel india juliet november oscar papa",
			summary: "TS decision B",
		});

		const result = await consolidationSweepBatch(db, 50);
		expect(result.processed).toBe(1);

		const { rows } = await db.execute("SELECT decision FROM local_dedup_log");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.decision).toBe("related");
	});

	// ---------------------------------------------------------------
	// writes 'different' for low similarity
	// ---------------------------------------------------------------

	it("writes 'different' for low similarity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sweep-different", tmpDir);

		// Insert 2 entities of same type with completely different content
		await insertEntity(db, {
			type: "Bug",
			name: "Entity A",
			content: "memory leak in the websocket handler causing OOM crashes",
			summary: "Memory bug",
		});
		await insertEntity(db, {
			type: "Bug",
			name: "Entity B",
			content: "CSS grid layout breaks on mobile safari with flex children overflow",
			summary: "CSS bug",
		});

		const result = await consolidationSweepBatch(db, 50);
		expect(result.processed).toBe(1);

		const { rows } = await db.execute("SELECT decision FROM local_dedup_log");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.decision).toBe("different");
	});

	// ---------------------------------------------------------------
	// skips pairs of different types
	// ---------------------------------------------------------------

	it("skips pairs of different types", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sweep-diff-types", tmpDir);

		// Insert entity type="Decision" and entity type="Bug" with identical content
		await insertEntity(db, {
			type: "Decision",
			name: "Entity A",
			content: "exactly the same content in both entities here",
			summary: "Decision entity",
		});
		await insertEntity(db, {
			type: "Bug",
			name: "Entity B",
			content: "exactly the same content in both entities here",
			summary: "Bug entity",
		});

		const result = await consolidationSweepBatch(db, 50);
		expect(result.processed).toBe(0);

		const { rows } = await db.execute("SELECT * FROM local_dedup_log");
		expect(rows).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// uses canonical ID ordering
	// ---------------------------------------------------------------

	it("uses canonical ID ordering", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sweep-canonical", tmpDir);

		// Insert 2 entities of same type
		await insertEntity(db, {
			type: "Concept",
			name: "Entity A",
			content: "alpha bravo charlie delta echo foxtrot golf hotel india",
			summary: "Entity A",
		});
		await insertEntity(db, {
			type: "Concept",
			name: "Entity B",
			content: "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
			summary: "Entity B",
		});

		await runConsolidationSweep(db);

		const { rows } = await db.execute("SELECT entity_a_id, entity_b_id FROM local_dedup_log");
		expect(rows).toHaveLength(1);
		// entity_a_id should always be less than entity_b_id (canonical ordering)
		const row = rows[0] as { entity_a_id: string; entity_b_id: string };
		expect(row.entity_a_id < row.entity_b_id).toBe(true);
	});

	// ---------------------------------------------------------------
	// does not re-process existing pairs
	// ---------------------------------------------------------------

	it("does not re-process existing pairs", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sweep-idempotent", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Entity A",
			content: "shared vocabulary across both entities in this pair test",
			summary: "Entity A",
		});
		await insertEntity(db, {
			type: "Concept",
			name: "Entity B",
			content: "shared vocabulary across both entities in this pair test again",
			summary: "Entity B",
		});

		// First run: 1 pair processed
		const first = await runConsolidationSweep(db);
		expect(first).toBe(1);

		// Second run: 0 pairs (already in log)
		const second = await runConsolidationSweep(db);
		expect(second).toBe(0);
	});

	// ---------------------------------------------------------------
	// respects batch size
	// ---------------------------------------------------------------

	it("respects batch size", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sweep-batch", tmpDir);

		// Insert 3 entities of same type (3 pairs: a-b, a-c, b-c)
		await insertEntity(db, {
			type: "Concept",
			name: "Entity A",
			content: "first entity content for batch size testing purposes",
			summary: "Entity A",
		});
		await insertEntity(db, {
			type: "Concept",
			name: "Entity B",
			content: "second entity content for batch size testing purposes",
			summary: "Entity B",
		});
		await insertEntity(db, {
			type: "Concept",
			name: "Entity C",
			content: "third entity content for batch size testing purposes",
			summary: "Entity C",
		});

		const result = await consolidationSweepBatch(db, 2);
		expect(result.processed).toBe(2);
		expect(result.remaining).toBe(true);
	});
});
