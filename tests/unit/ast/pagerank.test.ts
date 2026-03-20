import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computePageRank } from "@/ast/pagerank-builder";
import { insertEdge, invalidateEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

describe("computePageRank", () => {
	let repoRoot: string;
	let siaHome: string;
	let repoHash: string;
	let db: ReturnType<typeof openGraphDb>;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "sia-pagerank-repo-"));
		siaHome = mkdtempSync(join(tmpdir(), "sia-pagerank-home-"));
		mkdirSync(join(repoRoot, ".git"));
		repoHash = createHash("sha256").update(resolve(repoRoot)).digest("hex");
		db = openGraphDb(repoHash, siaHome);
	});

	afterEach(async () => {
		await db.close();
		rmSync(repoRoot, { recursive: true, force: true });
		rmSync(siaHome, { recursive: true, force: true });
	});

	it("assigns higher importance to heavily imported nodes", async () => {
		const a = await insertEntity(db, {
			type: "CodeEntity",
			name: "A",
			content: "A",
			summary: "A",
			file_paths: JSON.stringify(["a.ts"]),
			trust_tier: 2,
			confidence: 0.92,
		});
		const b = await insertEntity(db, {
			type: "CodeEntity",
			name: "B",
			content: "B",
			summary: "B",
			file_paths: JSON.stringify(["b.ts"]),
			trust_tier: 2,
			confidence: 0.92,
		});
		const c = await insertEntity(db, {
			type: "CodeEntity",
			name: "C",
			content: "C",
			summary: "C",
			file_paths: JSON.stringify(["c.ts"]),
			trust_tier: 2,
			confidence: 0.92,
		});

		await insertEdge(db, { from_id: b.id, to_id: a.id, type: "imports" });
		await insertEdge(db, { from_id: c.id, to_id: a.id, type: "imports" });

		await computePageRank(db);

		const rows = await db.execute("SELECT id, importance FROM graph_nodes WHERE id IN (?, ?, ?)", [
			a.id,
			b.id,
			c.id,
		]);
		const importance: Record<string, number> = {};
		for (const row of rows.rows) {
			importance[row.id as string] = row.importance as number;
		}

		expect(importance[a.id]).toBeGreaterThan(importance[b.id]);
		expect(importance[a.id]).toBeGreaterThan(importance[c.id]);
	});

	it("biases toward activeFileIds", async () => {
		const a = await insertEntity(db, {
			type: "CodeEntity",
			name: "A2",
			content: "A2",
			summary: "A2",
			file_paths: JSON.stringify(["a2.ts"]),
			trust_tier: 2,
			confidence: 0.92,
		});
		const b = await insertEntity(db, {
			type: "CodeEntity",
			name: "B2",
			content: "B2",
			summary: "B2",
			file_paths: JSON.stringify(["b2.ts"]),
			trust_tier: 2,
			confidence: 0.92,
		});

		await insertEdge(db, { from_id: a.id, to_id: b.id, type: "calls" });

		await computePageRank(db, [b.id]);

		const rows = await db.execute("SELECT id, importance FROM graph_nodes WHERE id IN (?, ?)", [
			a.id,
			b.id,
		]);
		const importance: Record<string, number> = {};
		for (const row of rows.rows) {
			importance[row.id as string] = row.importance as number;
		}

		expect(importance[b.id]).toBeGreaterThanOrEqual(importance[a.id]);
	});

	it("returns early for empty graph", async () => {
		const result = await computePageRank(db);
		expect(result.nodesScored).toBe(0);
		expect(result.converged).toBe(true);
	});

	it("excludes invalidated edges from computation", async () => {
		const a = await insertEntity(db, {
			type: "CodeEntity",
			name: "EdgeA",
			content: "A",
			summary: "A",
			trust_tier: 2,
			confidence: 0.92,
		});
		const b = await insertEntity(db, {
			type: "CodeEntity",
			name: "EdgeB",
			content: "B",
			summary: "B",
			trust_tier: 2,
			confidence: 0.92,
		});
		const edge = await insertEdge(db, {
			from_id: b.id,
			to_id: a.id,
			type: "imports",
		});
		await invalidateEdge(db, edge.id);

		const result = await computePageRank(db);
		expect(result.nodesScored).toBe(0);
	});

	it("returns convergence metrics", async () => {
		const a = await insertEntity(db, {
			type: "CodeEntity",
			name: "ConvA",
			content: "A",
			summary: "A",
			trust_tier: 2,
			confidence: 0.92,
		});
		const b = await insertEntity(db, {
			type: "CodeEntity",
			name: "ConvB",
			content: "B",
			summary: "B",
			trust_tier: 2,
			confidence: 0.92,
		});
		await insertEdge(db, { from_id: a.id, to_id: b.id, type: "calls" });

		const result = await computePageRank(db);
		expect(result.converged).toBe(true);
		expect(result.iterations).toBeGreaterThan(0);
		expect(result.finalDelta).toBeLessThan(1e-6);
		expect(result.nodesScored).toBe(2);
	});
});
