import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity, invalidateEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { bm25Search, sanitizeFts5Query } from "@/retrieval/bm25-search";

describe("bm25Search", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-bm25-test-${randomUUID()}`);
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
	// 1. Exact entity name returns as top result
	// ---------------------------------------------------------------
	it("exact entity name returns as top result", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("bm25-exact", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "AuthModule",
			content: "Handles authentication and authorization logic.",
			summary: "Auth module",
			created_by: "dev-1",
		});

		await insertEntity(db, {
			type: "Concept",
			name: "PaymentService",
			content: "Handles payment processing and billing.",
			summary: "Payment service",
			created_by: "dev-1",
		});

		const results = await bm25Search(db, "AuthModule");
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].entityId).toBeDefined();
		expect(results[0].score).toBeGreaterThanOrEqual(0);
		expect(results[0].score).toBeLessThanOrEqual(1);

		// The AuthModule entity should be the top result
		// Verify by checking that the returned entityId corresponds to AuthModule
		const topEntityResult = await db.execute(
			"SELECT name FROM entities WHERE id = ?",
			[results[0].entityId],
		);
		expect(topEntityResult.rows[0]?.name).toBe("AuthModule");
	});

	// ---------------------------------------------------------------
	// 2. Multi-term query ranks all-term matches higher
	// ---------------------------------------------------------------
	it("multi-term query ranks all-term matches higher", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("bm25-multi", tmpDir);

		// Entity matching both terms
		await insertEntity(db, {
			type: "Concept",
			name: "UserAuth",
			content: "User authentication service for login and session management.",
			summary: "User auth service",
			created_by: "dev-1",
		});

		// Entity matching only one term
		await insertEntity(db, {
			type: "Concept",
			name: "DatabaseMigration",
			content: "Manages database schema migrations for user tables.",
			summary: "DB migration tool",
			created_by: "dev-1",
		});

		// Entity matching only the other term
		await insertEntity(db, {
			type: "Concept",
			name: "TokenValidator",
			content: "Validates authentication tokens for API access.",
			summary: "Token validator",
			created_by: "dev-1",
		});

		const results = await bm25Search(db, "user authentication");
		expect(results.length).toBeGreaterThanOrEqual(1);

		// The entity with both terms ("UserAuth") should rank highest
		const topEntity = await db.execute(
			"SELECT name FROM entities WHERE id = ?",
			[results[0].entityId],
		);
		expect(topEntity.rows[0]?.name).toBe("UserAuth");
	});

	// ---------------------------------------------------------------
	// 3. package_path filter scopes to package
	// ---------------------------------------------------------------
	it("package_path filter scopes to package", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("bm25-pkg", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "FrontendRouter",
			content: "Routes requests in the frontend application.",
			summary: "Frontend router",
			package_path: "packages/frontend",
			created_by: "dev-1",
		});

		await insertEntity(db, {
			type: "Concept",
			name: "BackendRouter",
			content: "Routes requests in the backend application.",
			summary: "Backend router",
			package_path: "packages/backend",
			created_by: "dev-1",
		});

		const results = await bm25Search(db, "router", {
			packagePath: "packages/frontend",
		});

		expect(results).toHaveLength(1);
		const entity = await db.execute(
			"SELECT name FROM entities WHERE id = ?",
			[results[0].entityId],
		);
		expect(entity.rows[0]?.name).toBe("FrontendRouter");
	});

	// ---------------------------------------------------------------
	// 4. Invalidated entities excluded
	// ---------------------------------------------------------------
	it("invalidated entities excluded", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("bm25-invalidated", tmpDir);

		const entity = await insertEntity(db, {
			type: "Decision",
			name: "OldAuthDecision",
			content: "Use JWT tokens for authentication.",
			summary: "Old auth decision",
			created_by: "dev-1",
		});

		await invalidateEntity(db, entity.id);

		const results = await bm25Search(db, "OldAuthDecision");
		expect(results).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// 5. Paranoid mode excludes Tier 4
	// ---------------------------------------------------------------
	it("paranoid mode excludes Tier 4 entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("bm25-paranoid", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "TrustedModule",
			content: "A trusted module with high confidence.",
			summary: "Trusted module",
			trust_tier: 2,
			created_by: "dev-1",
		});

		await insertEntity(db, {
			type: "Concept",
			name: "ExternalModule",
			content: "An external module from untrusted source.",
			summary: "External module",
			trust_tier: 4,
			created_by: "dev-1",
		});

		const results = await bm25Search(db, "module", { paranoid: true });
		expect(results).toHaveLength(1);

		const entity = await db.execute(
			"SELECT name FROM entities WHERE id = ?",
			[results[0].entityId],
		);
		expect(entity.rows[0]?.name).toBe("TrustedModule");
	});

	// ---------------------------------------------------------------
	// 6. Empty query returns empty array
	// ---------------------------------------------------------------
	it("empty query returns empty array", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("bm25-empty", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "SomeEntity",
			content: "Some content.",
			summary: "Some summary",
			created_by: "dev-1",
		});

		expect(await bm25Search(db, "")).toEqual([]);
		expect(await bm25Search(db, "   ")).toEqual([]);
		expect(await bm25Search(db, "***")).toEqual([]);
	});

	// ---------------------------------------------------------------
	// 7. Quoted phrase search works
	// ---------------------------------------------------------------
	it("quoted phrase search works", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("bm25-phrase", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "AuthTokenService",
			content: "The auth token service validates and refreshes JWT tokens.",
			summary: "Auth token service",
			created_by: "dev-1",
		});

		await insertEntity(db, {
			type: "Concept",
			name: "TokenBucketRateLimiter",
			content: "Rate limiter using token bucket algorithm for auth endpoints.",
			summary: "Token bucket rate limiter",
			created_by: "dev-1",
		});

		const results = await bm25Search(db, '"auth token"');
		expect(results.length).toBeGreaterThanOrEqual(1);

		// The entity with the exact phrase "auth token" should be the top result
		const topEntity = await db.execute(
			"SELECT name FROM entities WHERE id = ?",
			[results[0].entityId],
		);
		expect(topEntity.rows[0]?.name).toBe("AuthTokenService");
	});
});

describe("sanitizeFts5Query", () => {
	it("strips special characters from unquoted text", () => {
		expect(sanitizeFts5Query("hello+world")).toBe("hello world");
		expect(sanitizeFts5Query("test*")).toBe("test");
	});

	it("preserves quoted phrases", () => {
		expect(sanitizeFts5Query('"auth module"')).toBe('"auth module"');
		expect(sanitizeFts5Query('hello "exact phrase" world')).toBe(
			'hello "exact phrase" world',
		);
	});

	it("returns empty string for empty input", () => {
		expect(sanitizeFts5Query("")).toBe("");
		expect(sanitizeFts5Query("   ")).toBe("");
	});
});
