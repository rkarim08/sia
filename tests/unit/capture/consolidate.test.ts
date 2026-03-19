import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { consolidate, wordJaccard } from "@/capture/consolidate";
import type { CandidateFact } from "@/capture/types";
import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

// ---------------------------------------------------------------
// wordJaccard unit tests
// ---------------------------------------------------------------

describe("wordJaccard", () => {
	it("returns 1.0 for identical strings", () => {
		expect(wordJaccard("hello world", "hello world")).toBe(1.0);
	});

	it("returns 0.0 for completely different strings", () => {
		expect(wordJaccard("hello world", "goodbye moon")).toBe(0.0);
	});

	it("returns correct ratio for partial overlap", () => {
		// sets: {a,b,c,d} and {a,b,e,f} => intersection={a,b}=2, union={a,b,c,d,e,f}=6
		const result = wordJaccard("a b c d", "a b e f");
		expect(result).toBeCloseTo(2 / 6, 3);
	});

	it("returns 0 when first string is empty", () => {
		expect(wordJaccard("", "hello")).toBe(0);
	});

	it("returns 0 when second string is empty", () => {
		expect(wordJaccard("hello", "")).toBe(0);
	});

	it("returns 0 when both strings are empty", () => {
		expect(wordJaccard("", "")).toBe(0);
	});
});

// ---------------------------------------------------------------
// consolidate integration tests
// ---------------------------------------------------------------

describe("consolidate", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	function makeCandidate(overrides: Partial<CandidateFact> = {}): CandidateFact {
		return {
			type: "Concept",
			name: "Test Entity",
			content: "some content about testing",
			summary: "A test entity",
			tags: ["test"],
			file_paths: ["src/test.ts"],
			trust_tier: 2,
			confidence: 0.85,
			...overrides,
		};
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
	// ADD: new candidate with no existing match is inserted
	// ---------------------------------------------------------------

	it("ADD: inserts new candidate when no existing match", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("consol-add", tmpDir);

		const candidates = [makeCandidate({ name: "Brand New Entity" })];
		const result = await consolidate(db, candidates);

		expect(result.added).toBe(1);
		expect(result.updated).toBe(0);
		expect(result.invalidated).toBe(0);
		expect(result.noops).toBe(0);

		// Verify entity exists in DB
		const rows = await db.execute(
			"SELECT * FROM entities WHERE name = ? AND t_valid_until IS NULL",
			["Brand New Entity"],
		);
		expect(rows.rows).toHaveLength(1);
		expect((rows.rows[0] as unknown as Entity).type).toBe("Concept");
		expect((rows.rows[0] as unknown as Entity).content).toBe("some content about testing");

		// Verify audit log entry
		const audit = await db.execute("SELECT operation FROM audit_log WHERE operation = 'ADD'");
		expect(audit.rows.length).toBeGreaterThanOrEqual(1);
	});

	// ---------------------------------------------------------------
	// NOOP: duplicate candidate with similarity > 0.8
	// ---------------------------------------------------------------

	it("NOOP: skips candidate when existing entity content is very similar", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("consol-noop", tmpDir);

		// Pre-insert an entity with nearly identical content
		await insertEntity(db, {
			type: "Concept",
			name: "Existing Entity",
			content: "the quick brown fox jumps over the lazy dog",
			summary: "A fox entity",
		});

		// Candidate with >0.8 similarity (same words, just one extra)
		const candidates = [
			makeCandidate({
				name: "Existing Entity",
				content: "the quick brown fox jumps over the lazy dog today",
			}),
		];
		const result = await consolidate(db, candidates);

		expect(result.noops).toBe(1);
		expect(result.added).toBe(0);
		expect(result.updated).toBe(0);
		expect(result.invalidated).toBe(0);

		// Verify NOOP audit entry
		const audit = await db.execute("SELECT operation FROM audit_log WHERE operation = 'NOOP'");
		expect(audit.rows).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// UPDATE: similar candidate with 0.4 <= similarity <= 0.8
	// ---------------------------------------------------------------

	it("UPDATE: updates entity when content is moderately similar", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("consol-update", tmpDir);

		// Pre-insert an entity
		await insertEntity(db, {
			type: "Concept",
			name: "Evolving Entity",
			content: "alpha beta gamma delta epsilon zeta eta theta iota kappa",
			summary: "Original summary",
		});

		// Candidate sharing 7/13 words => jaccard ~0.538 (in [0.4, 0.8] range)
		const candidates = [
			makeCandidate({
				name: "Evolving Entity",
				content: "alpha beta gamma delta epsilon zeta eta new1 new2 new3",
				summary: "Updated summary",
			}),
		];
		const result = await consolidate(db, candidates);

		expect(result.updated).toBe(1);
		expect(result.added).toBe(0);
		expect(result.invalidated).toBe(0);
		expect(result.noops).toBe(0);

		// Verify content was updated
		const rows = await db.execute(
			"SELECT * FROM entities WHERE name = ? AND t_valid_until IS NULL",
			["Evolving Entity"],
		);
		expect(rows.rows).toHaveLength(1);
		expect((rows.rows[0] as unknown as Entity).content).toBe(
			"alpha beta gamma delta epsilon zeta eta new1 new2 new3",
		);
		expect((rows.rows[0] as unknown as Entity).summary).toBe("Updated summary");
	});

	// ---------------------------------------------------------------
	// INVALIDATE: contradictory content with similarity < 0.4
	// ---------------------------------------------------------------

	it("INVALIDATE: invalidates old and adds new when content is very different", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("consol-invalidate", tmpDir);

		// Pre-insert an entity
		const original = await insertEntity(db, {
			type: "Decision",
			name: "Architecture Choice",
			content: "we use monolith architecture with shared database",
			summary: "Monolith architecture",
		});

		// Candidate with completely different content (jaccard < 0.4)
		const candidates = [
			makeCandidate({
				type: "Decision",
				name: "Architecture Choice",
				content: "microservices deployed on kubernetes with event sourcing",
				summary: "Microservices architecture",
			}),
		];
		const result = await consolidate(db, candidates);

		expect(result.invalidated).toBe(1);
		expect(result.added).toBe(1);
		expect(result.updated).toBe(0);
		expect(result.noops).toBe(0);

		// Old entity should be invalidated
		const oldEntity = await db.execute("SELECT * FROM entities WHERE id = ?", [original.id]);
		expect((oldEntity.rows[0] as unknown as Entity).t_valid_until).not.toBeNull();

		// New entity should exist
		const newRows = await db.execute(
			"SELECT * FROM entities WHERE name = ? AND t_valid_until IS NULL",
			["Architecture Choice"],
		);
		expect(newRows.rows).toHaveLength(1);
		expect((newRows.rows[0] as unknown as Entity).content).toBe(
			"microservices deployed on kubernetes with event sourcing",
		);
		expect((newRows.rows[0] as unknown as Entity).id).not.toBe(original.id);

		// Verify audit entries for both INVALIDATE and ADD
		const auditInvalidate = await db.execute(
			"SELECT operation FROM audit_log WHERE operation = 'INVALIDATE'",
		);
		expect(auditInvalidate.rows.length).toBeGreaterThanOrEqual(1);
	});

	// ---------------------------------------------------------------
	// Transaction atomicity: error in batch rolls back all writes
	// ---------------------------------------------------------------

	it("transaction atomicity: error in batch rolls back all writes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("consol-txn", tmpDir);

		// Count entities before
		const before = await db.execute("SELECT COUNT(*) as cnt FROM entities");
		const countBefore = (before.rows[0] as { cnt: number }).cnt;

		// Create a wrapper that intercepts execute calls even inside transactions.
		// db.transaction() passes its own txProxy to fn, so we must re-wrap that
		// proxy so the bomb's execute interceptor is used within the transaction.
		let insertCount = 0;
		function wrapWithBomb(inner: SiaDb): SiaDb {
			return {
				execute: async (sql, params) => {
					if (sql.trimStart().toUpperCase().startsWith("INSERT INTO ENTITIES")) {
						insertCount++;
						if (insertCount >= 2) {
							throw new Error("Simulated failure on second insert");
						}
					}
					return inner.execute(sql, params);
				},
				executeMany: (stmts) => inner.executeMany(stmts),
				transaction: () => {
					throw new Error("Nested transactions not supported");
				},
				close: () => inner.close(),
				rawSqlite: () => inner.rawSqlite(),
			};
		}
		const bombDb: SiaDb = {
			execute: (sql, params) => wrapWithBomb(db as SiaDb).execute(sql, params),
			executeMany: (stmts) => (db as SiaDb).executeMany(stmts),
			transaction: async (fn) => {
				// Delegate to real transaction but re-wrap the tx proxy with our bomb
				await (db as SiaDb).transaction(async (tx) => {
					await fn(wrapWithBomb(tx));
				});
			},
			close: () => (db as SiaDb).close(),
			rawSqlite: () => (db as SiaDb).rawSqlite(),
		};

		const candidates = [
			makeCandidate({ name: "First Entity" }),
			makeCandidate({ name: "Second Entity" }),
		];

		await expect(consolidate(bombDb, candidates)).rejects.toThrow(
			"Simulated failure on second insert",
		);

		// Verify nothing was written (transaction rolled back)
		const after = await db.execute("SELECT COUNT(*) as cnt FROM entities");
		const countAfter = (after.rows[0] as { cnt: number }).cnt;
		expect(countAfter).toBe(countBefore);
	});
});
