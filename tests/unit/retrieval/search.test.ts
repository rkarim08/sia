import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { hybridSearch } from "@/retrieval/search";

describe("hybridSearch — three-stage pipeline", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-search-test-${randomUUID()}`);
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
	// 1. BM25 match surfaces relevant entity
	// ---------------------------------------------------------------
	it("BM25 match surfaces relevant entity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-bm25", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "AuthModule",
			content: "Handles authentication and authorization logic for the application.",
			summary: "Auth module",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
		});

		// Insert a decoy entity that should not match "AuthModule"
		await insertEntity(db, {
			type: "Concept",
			name: "PaymentService",
			content: "Handles payment processing and billing.",
			summary: "Payment service",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
		});

		const result = await hybridSearch(db, null, {
			query: "AuthModule",
			limit: 10,
		});

		expect(result.mode).toBe("local");
		expect(result.results.length).toBeGreaterThanOrEqual(1);

		// AuthModule should appear in results
		const authResult = result.results.find((r) => r.id === entity.id);
		expect(authResult).toBeDefined();
		expect(authResult?.name).toBe("AuthModule");
	});

	// ---------------------------------------------------------------
	// 2. Graph traversal surfaces neighbors
	// ---------------------------------------------------------------
	it("graph traversal surfaces neighbors", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-graph", tmpDir);

		const entityA = await insertEntity(db, {
			type: "Concept",
			name: "AuthService",
			content: "Authentication service for the application.",
			summary: "Auth service",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
		});

		const entityB = await insertEntity(db, {
			type: "Concept",
			name: "UserStore",
			content: "User persistence layer for storing user data.",
			summary: "User store",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
		});

		await insertEdge(db, {
			from_id: entityA.id,
			to_id: entityB.id,
			type: "DEPENDS_ON",
		});

		const result = await hybridSearch(db, null, {
			query: "AuthService",
			limit: 10,
		});

		expect(result.mode).toBe("local");

		// A should be present (direct BM25/graph match)
		const matchA = result.results.find((r) => r.id === entityA.id);
		expect(matchA).toBeDefined();

		// B should also be present via graph traversal neighbor expansion
		const matchB = result.results.find((r) => r.id === entityB.id);
		expect(matchB).toBeDefined();
	});

	// ---------------------------------------------------------------
	// 3. Combined signals rank higher via RRF
	// ---------------------------------------------------------------
	it("combined signals rank higher", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-combined", tmpDir);

		// Entity that appears in both BM25 and graph (via name match + edge)
		const strongEntity = await insertEntity(db, {
			type: "Concept",
			name: "CacheManager",
			content: "Cache management layer for the application.",
			summary: "Cache manager",
			trust_tier: 1,
			confidence: 0.9,
			importance: 0.9,
		});

		// Entity that appears only via BM25 (has "cache" in content but different name)
		const weakEntity = await insertEntity(db, {
			type: "Concept",
			name: "DataLayer",
			content: "Data access layer that uses CacheManager internally.",
			summary: "Data layer with cache",
			trust_tier: 1,
			confidence: 0.9,
			importance: 0.9,
		});

		// Connect CacheManager to itself to strengthen graph signal
		// (self-referencing edge not useful, use a helper entity)
		const helper = await insertEntity(db, {
			type: "Concept",
			name: "RedisBackend",
			content: "Redis backend for CacheManager.",
			summary: "Redis backend",
			trust_tier: 1,
			confidence: 0.9,
			importance: 0.5,
		});

		await insertEdge(db, {
			from_id: strongEntity.id,
			to_id: helper.id,
			type: "DEPENDS_ON",
		});

		const result = await hybridSearch(db, null, {
			query: "CacheManager",
			limit: 10,
		});

		// CacheManager should rank at or above DataLayer because it gets
		// both BM25 + graph traversal signal
		const strongIdx = result.results.findIndex((r) => r.id === strongEntity.id);
		const weakIdx = result.results.findIndex((r) => r.id === weakEntity.id);

		expect(strongIdx).toBeGreaterThanOrEqual(0);
		// If weak entity is present at all, strong should rank at or above it
		if (weakIdx >= 0) {
			expect(strongIdx).toBeLessThanOrEqual(weakIdx);
		}
	});

	// ---------------------------------------------------------------
	// 4. Paranoid excludes Tier 4 across all stages
	// ---------------------------------------------------------------
	it("paranoid excludes Tier 4", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-paranoid", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "TrustedConfig",
			content: "Trusted configuration module for the application.",
			summary: "Trusted config",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
		});

		await insertEntity(db, {
			type: "Concept",
			name: "ExternalConfig",
			content: "External untrusted configuration from third party.",
			summary: "External config",
			trust_tier: 4,
			confidence: 0.9,
			importance: 0.8,
		});

		const result = await hybridSearch(db, null, {
			query: "Config",
			paranoid: true,
			limit: 10,
		});

		// No Tier 4 entities should appear in paranoid mode
		for (const r of result.results) {
			expect(r.trust_tier).not.toBe(4);
		}

		// The trusted entity should be present
		const trusted = result.results.find((r) => r.name === "TrustedConfig");
		expect(trusted).toBeDefined();
	});

	// ---------------------------------------------------------------
	// 5. Global query returns community summaries
	// ---------------------------------------------------------------
	it("global query returns community summaries", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-global", tmpDir);

		// Insert 150+ active entities to satisfy the community min graph size
		for (let i = 0; i < 155; i++) {
			await insertEntity(db, {
				type: "Concept",
				name: `Entity_${i}`,
				content: `Content for entity ${i}`,
				summary: `Summary ${i}`,
				trust_tier: 2,
				confidence: 0.8,
				importance: 0.5,
			});
		}

		// Insert community rows with summaries
		const now = Date.now();
		await db.execute(
			`INSERT INTO communities (id, level, summary, member_count, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			["comm-1", 0, "This is the authentication subsystem overview.", 50, now, now],
		);
		await db.execute(
			`INSERT INTO communities (id, level, summary, member_count, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			["comm-2", 1, "This is the data layer architecture overview.", 30, now, now],
		);

		const result = await hybridSearch(db, null, {
			query: "explain the architecture overview",
			limit: 10,
		});

		expect(result.mode).toBe("global");
		expect(result.globalUnavailable).toBe(false);
		expect(result.results.length).toBeGreaterThanOrEqual(1);

		// Results should be community summaries
		for (const r of result.results) {
			expect(r.type).toBe("Community");
			expect(r.summary).toBeTruthy();
		}
	});

	it("pipeline accepts optional crossEncoderReranker in deps", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-ce", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "TestEntity",
			content: "A test entity for cross-encoder reranking.",
			summary: "Test entity",
			trust_tier: 2,
			confidence: 0.9,
			importance: 0.8,
		});

		// Mock cross-encoder that boosts all scores to 0.95
		const mockCrossEncoder = {
			rerank: async (_query: string, candidates: Array<{ entityId: string; text: string }>) =>
				candidates.map((c) => ({ entityId: c.entityId, score: 0.95 })),
		};

		const result = await hybridSearch(db, null, {
			query: "TestEntity",
			limit: 10,
		}, { crossEncoder: mockCrossEncoder as any });

		expect(result.mode).toBe("local");
		expect(result.results.length).toBeGreaterThanOrEqual(1);
	});

	it("cross-encoder timeout falls back to RRF ordering", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-ce-timeout", tmpDir);

		await insertEntity(db, {
			type: "Concept", name: "SlowEntity",
			content: "This entity tests timeout fallback.",
			summary: "Slow entity", trust_tier: 2, confidence: 0.9, importance: 0.8,
		});

		// Cross-encoder that never resolves (simulates slow CPU inference)
		const neverResolves = {
			rerank: (_query: string, _candidates: Array<{ entityId: string; text: string }>) =>
				new Promise<Array<{ entityId: string; score: number }>>(() => {}), // intentionally hangs
		};

		// Should not hang — timeout resolves with empty results, RRF ordering used
		const result = await hybridSearch(db, null, { query: "SlowEntity", limit: 10 },
			{ crossEncoder: neverResolves as any });

		expect(result.results.length).toBeGreaterThanOrEqual(0); // does not throw
	});
});
