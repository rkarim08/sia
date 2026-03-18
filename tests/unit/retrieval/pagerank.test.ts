import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import {
	EDGE_TYPE_WEIGHTS,
	getEdgeWeight,
	getImportanceScore,
	updateImportanceScores,
} from "@/retrieval/pagerank";

describe("retrieval/pagerank", () => {
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
	// EDGE_TYPE_WEIGHTS has correct values
	// ---------------------------------------------------------------

	it("EDGE_TYPE_WEIGHTS has correct values", () => {
		expect(EDGE_TYPE_WEIGHTS.calls).toBe(0.5);
		expect(EDGE_TYPE_WEIGHTS.pertains_to).toBe(0.4);
		expect(EDGE_TYPE_WEIGHTS.imports).toBe(0.3);
		expect(EDGE_TYPE_WEIGHTS.member_of).toBe(0.1);
	});

	// ---------------------------------------------------------------
	// getImportanceScore returns 0.5 for non-existent node
	// ---------------------------------------------------------------

	it("getImportanceScore returns 0.5 for non-existent node", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pr-nonexistent", tmpDir);

		const score = await getImportanceScore(db, "nonexistent-id");
		expect(score).toBe(0.5);
	});

	// ---------------------------------------------------------------
	// updateImportanceScores batch-updates entities and returns count
	// ---------------------------------------------------------------

	it("updateImportanceScores batch-updates entities and returns count", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pr-batch-update", tmpDir);

		const entity1 = await insertEntity(db, {
			type: "Concept",
			name: "Entity A",
			content: "Content A",
			summary: "Summary A",
			created_by: "dev-1",
		});

		const entity2 = await insertEntity(db, {
			type: "Concept",
			name: "Entity B",
			content: "Content B",
			summary: "Summary B",
			created_by: "dev-1",
		});

		const scores = new Map<string, number>([
			[entity1.id, 0.8],
			[entity2.id, 0.3],
		]);

		const count = await updateImportanceScores(db, scores);
		expect(count).toBe(2);

		const score1 = await getImportanceScore(db, entity1.id);
		expect(score1).toBe(0.8);

		const score2 = await getImportanceScore(db, entity2.id);
		expect(score2).toBe(0.3);
	});

	it("updateImportanceScores returns 0 for empty map", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pr-empty-map", tmpDir);

		const count = await updateImportanceScores(db, new Map());
		expect(count).toBe(0);
	});

	it("updateImportanceScores writes a PAGERANK_UPDATE audit entry", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pr-audit", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Audited Entity",
			content: "Content",
			summary: "Summary",
			created_by: "dev-1",
		});

		await updateImportanceScores(db, new Map([[entity.id, 0.9]]));

		const result = await db.execute(
			"SELECT operation FROM audit_log WHERE operation = 'PAGERANK_UPDATE'",
			[],
		);
		expect(result.rows.length).toBeGreaterThanOrEqual(1);
	});

	// ---------------------------------------------------------------
	// getEdgeWeight returns 0.1 for unknown edge types
	// ---------------------------------------------------------------

	it("getEdgeWeight returns 0.1 for unknown edge types", () => {
		expect(getEdgeWeight("unknown_type")).toBe(0.1);
		expect(getEdgeWeight("")).toBe(0.1);
		expect(getEdgeWeight("calls")).toBe(0.5);
		expect(getEdgeWeight("pertains_to")).toBe(0.4);
		expect(getEdgeWeight("imports")).toBe(0.3);
		expect(getEdgeWeight("member_of")).toBe(0.1);
	});
});
