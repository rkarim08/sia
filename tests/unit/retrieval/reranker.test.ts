import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { type RankedCandidate, rerank, rrfCombine } from "@/retrieval/reranker";

describe("reranker", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-reranker-test-${randomUUID()}`);
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
	// 1. Entity appearing in all 3 lists ranks higher than entity in only 1 list
	// ---------------------------------------------------------------
	it("entity in all 3 lists ranks higher than entity in only 1 list", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("reranker-multi", tmpDir);

		const entityAll = await insertEntity(db, {
			type: "Concept",
			name: "MultiSignalEntity",
			content: "Appears in all three retrieval signals.",
			summary: "Multi-signal entity",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		const entityOne = await insertEntity(db, {
			type: "Concept",
			name: "SingleSignalEntity",
			content: "Appears in only one retrieval signal.",
			summary: "Single-signal entity",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		// Simulate 3 retrieval lists — entityAll appears in all 3, entityOne in only 1
		const list1: RankedCandidate[] = [
			{ entityId: entityAll.id, score: 0.9 },
			{ entityId: entityOne.id, score: 0.8 },
		];
		const list2: RankedCandidate[] = [{ entityId: entityAll.id, score: 0.85 }];
		const list3: RankedCandidate[] = [{ entityId: entityAll.id, score: 0.7 }];

		const rrfScores = rrfCombine(list1, list2, list3);

		// entityAll should have a higher RRF score
		expect(rrfScores.get(entityAll.id) as number).toBeGreaterThan(
			rrfScores.get(entityOne.id) as number,
		);

		const results = await rerank(db, rrfScores);
		expect(results.length).toBe(2);
		expect(results[0].id).toBe(entityAll.id);
		expect(results[1].id).toBe(entityOne.id);
	});

	// ---------------------------------------------------------------
	// 2. Tier 1 entity scores higher than identical Tier 4 entity
	// ---------------------------------------------------------------
	it("Tier 1 entity scores higher than identical Tier 4 entity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("reranker-tier", tmpDir);

		const tier1 = await insertEntity(db, {
			type: "Concept",
			name: "Tier1Entity",
			content: "High-trust entity.",
			summary: "Tier 1 entity",
			trust_tier: 1,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		const tier4 = await insertEntity(db, {
			type: "Concept",
			name: "Tier4Entity",
			content: "Low-trust entity.",
			summary: "Tier 4 entity",
			trust_tier: 4,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		// Both appear in one list with identical score
		const list: RankedCandidate[] = [
			{ entityId: tier1.id, score: 0.9 },
			{ entityId: tier4.id, score: 0.9 },
		];

		const rrfScores = rrfCombine(list);
		const results = await rerank(db, rrfScores);

		expect(results.length).toBe(2);
		expect(results[0].id).toBe(tier1.id);
		expect(results[1].id).toBe(tier4.id);
	});

	// ---------------------------------------------------------------
	// 3. Paranoid mode completely excludes Tier 4
	// ---------------------------------------------------------------
	it("paranoid mode completely excludes Tier 4", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("reranker-paranoid", tmpDir);

		const tier2 = await insertEntity(db, {
			type: "Concept",
			name: "TrustedEntity",
			content: "Trusted entity content.",
			summary: "Trusted",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		const tier4 = await insertEntity(db, {
			type: "Concept",
			name: "UntrustedEntity",
			content: "Untrusted entity content.",
			summary: "Untrusted",
			trust_tier: 4,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		const list: RankedCandidate[] = [
			{ entityId: tier2.id, score: 0.5 },
			{ entityId: tier4.id, score: 0.9 },
		];

		const rrfScores = rrfCombine(list);
		const results = await rerank(db, rrfScores, { paranoid: true });

		expect(results.length).toBe(1);
		expect(results[0].id).toBe(tier2.id);
		// Ensure no Tier 4 entity in results
		for (const r of results) {
			expect(r.trust_tier).not.toBe(4);
		}
	});

	// ---------------------------------------------------------------
	// 4. Bug-fix task type boosts Bug entities higher
	// ---------------------------------------------------------------
	it("bug-fix task type boosts Bug entities higher", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("reranker-bugfix", tmpDir);

		const bugEntity = await insertEntity(db, {
			type: "Bug",
			name: "NullPointerBug",
			content: "Null pointer exception in auth module.",
			summary: "NPE bug",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		const conceptEntity = await insertEntity(db, {
			type: "Concept",
			name: "AuthConcept",
			content: "Authentication architecture concept.",
			summary: "Auth concept",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		// Both in same list with identical scores
		const list: RankedCandidate[] = [
			{ entityId: bugEntity.id, score: 0.9 },
			{ entityId: conceptEntity.id, score: 0.9 },
		];

		const rrfScores = rrfCombine(list);

		// Without task boost, both should be very close (same tier, confidence, importance)
		const _resultsNoBug = await rerank(db, rrfScores);

		// With bug-fix task type, Bug entity should get boosted
		const resultsBugFix = await rerank(db, rrfScores, { taskType: "bug-fix" });

		expect(resultsBugFix[0].id).toBe(bugEntity.id);
		expect(resultsBugFix[0].type).toBe("Bug");

		// Find the Bug entity score without boost — it should tie or be close
		// With the boost it should definitively be first
		expect(resultsBugFix[0].id).toBe(bugEntity.id);
	});

	// ---------------------------------------------------------------
	// 5. Package-path boost: same-package entity ranks above cross-package
	// ---------------------------------------------------------------
	it("package-path boost ranks same-package entity higher", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("reranker-pkg", tmpDir);

		const samePackage = await insertEntity(db, {
			type: "Concept",
			name: "SamePackageEntity",
			content: "Entity in the active package.",
			summary: "Same package",
			package_path: "packages/auth",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		const otherPackage = await insertEntity(db, {
			type: "Concept",
			name: "OtherPackageEntity",
			content: "Entity in a different package.",
			summary: "Other package",
			package_path: "packages/billing",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		// Both in same list with identical scores
		const list: RankedCandidate[] = [
			{ entityId: samePackage.id, score: 0.9 },
			{ entityId: otherPackage.id, score: 0.9 },
		];

		const rrfScores = rrfCombine(list);
		const results = await rerank(db, rrfScores, {
			packagePath: "packages/auth",
		});

		expect(results.length).toBe(2);
		expect(results[0].id).toBe(samePackage.id);
	});

	// ---------------------------------------------------------------
	// 6. Empty input returns empty array
	// ---------------------------------------------------------------
	it("empty input returns empty array", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("reranker-empty", tmpDir);

		const emptyScores = new Map<string, number>();
		const results = await rerank(db, emptyScores);

		expect(results).toEqual([]);
	});

	// ---------------------------------------------------------------
	// 7. Rerank updates access_count and last_accessed on returned entities
	// ---------------------------------------------------------------
	it("updates access_count and last_accessed on returned entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("reranker-touch", tmpDir);

		const e1 = await insertEntity(db, {
			type: "Concept",
			name: "TouchEntity1",
			content: "First entity to touch.",
			summary: "Entity 1",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		const e2 = await insertEntity(db, {
			type: "Concept",
			name: "TouchEntity2",
			content: "Second entity to touch.",
			summary: "Entity 2",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		const e3 = await insertEntity(db, {
			type: "Concept",
			name: "TouchEntity3",
			content: "Third entity to touch.",
			summary: "Entity 3",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
			created_by: "dev-1",
		});

		// Establish a baseline: initial access_count should be 0 for fresh inserts
		const list: RankedCandidate[] = [
			{ entityId: e1.id, score: 0.9 },
			{ entityId: e2.id, score: 0.8 },
			{ entityId: e3.id, score: 0.7 },
		];

		const rrfScores = rrfCombine(list);
		const results = await rerank(db, rrfScores);

		expect(results.length).toBe(3);
		const returnedIds = new Set(results.map((r) => r.id));
		expect(returnedIds.has(e1.id)).toBe(true);
		expect(returnedIds.has(e2.id)).toBe(true);
		expect(returnedIds.has(e3.id)).toBe(true);

		// Verify access_count >= 1 and last_accessed > 0 for all returned entities
		const placeholders = [...returnedIds].map(() => "?").join(", ");
		const dbResult = await db.execute(
			`SELECT id, access_count, last_accessed FROM graph_nodes WHERE id IN (${placeholders})`,
			[...returnedIds],
		);

		expect(dbResult.rows.length).toBe(3);
		for (const row of dbResult.rows) {
			expect(Number(row.access_count)).toBeGreaterThanOrEqual(1);
			expect(Number(row.last_accessed)).toBeGreaterThan(0);
		}
	});
});
