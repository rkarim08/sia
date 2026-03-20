import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	compactVersions,
	identifyLowConfidenceClaims,
	recomputePageRank,
	runDeepValidation,
	validateDocumentation,
} from "@/freshness/deep-validation";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-deepval-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("deep-validation", () => {
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

	// ─── runDeepValidation ──────────────────────────────────────────────────

	describe("runDeepValidation", () => {
		it("completes and returns a result with all required fields", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-run", tmpDir);

			const repoRoot = tmpDir;
			const result = await runDeepValidation(db, repoRoot);

			expect(result).toMatchObject({
				documentsChecked: expect.any(Number),
				staleDocsFound: expect.any(Number),
				claimsReVerified: expect.any(Number),
				claimsInvalidated: expect.any(Number),
				claimsConfirmed: expect.any(Number),
				nodesScored: expect.any(Number),
				versionsCompacted: expect.any(Number),
				ftsOptimized: expect.any(Boolean),
				durationMs: expect.any(Number),
			});

			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});

		it("respects custom config for maxClaimsToVerify", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-config", tmpDir);

			// Insert 5 tier-3 entities with varying low confidence
			for (let i = 0; i < 5; i++) {
				await insertEntity(db, {
					type: "Decision",
					name: `Claim ${i}`,
					content: `content ${i}`,
					summary: `summary ${i}`,
					trust_tier: 3,
					confidence: 0.05 + i * 0.01,
				});
			}

			const result = await runDeepValidation(db, tmpDir, { maxClaimsToVerify: 2 });
			// With maxClaims=2, at most 2 claims are processed
			expect(result.claimsReVerified).toBeLessThanOrEqual(2);
		});
	});

	// ─── validateDocumentation ──────────────────────────────────────────────

	describe("validateDocumentation", () => {
		it("returns zero checked for an empty database", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-docs-empty", tmpDir);

			const result = await validateDocumentation(db, tmpDir);

			expect(result.checked).toBe(0);
			expect(result.staleFound).toBe(0);
		});

		it("skips entities with type not in target types", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-docs-skip", tmpDir);

			// Insert entity with wrong type — should be ignored
			await insertEntity(db, {
				type: "Concept",
				name: "Some concept",
				content: "content",
				summary: "summary",
				trust_tier: 1,
				file_paths: JSON.stringify(["some/path.ts"]),
			});

			const result = await validateDocumentation(db, tmpDir);
			expect(result.checked).toBe(0);
		});

		it("flags entities whose referenced files were modified after t_created", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-docs-stale", tmpDir);

			// Create a real file on disk
			const filePath = join(tmpDir, "module.ts");
			writeFileSync(filePath, "export const x = 1;");

			// Insert a CodeEntity with trust_tier=1 and file_paths pointing to the file.
			// Set t_created to a timestamp in the past so the file appears newer.
			const pastTime = Date.now() - 200_000; // 200 seconds ago
			await db.execute(
				`INSERT INTO graph_nodes (
					id, type, name, content, summary, tags, file_paths,
					trust_tier, confidence, base_confidence,
					importance, base_importance, access_count, edge_count,
					last_accessed, created_at, t_created,
					visibility, created_by
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					randomUUID(),
					"CodeEntity",
					"OldEntity",
					"some code",
					"summary",
					"[]",
					JSON.stringify([filePath]),
					1,
					0.9,
					0.9,
					0.5,
					0.5,
					0,
					0,
					pastTime,
					pastTime,
					pastTime, // t_created far in the past
					"private",
					"local",
				],
			);

			const result = await validateDocumentation(db, tmpDir);

			// The file exists and its mtime should be >= t_created (we just wrote it),
			// so it should be flagged stale.
			expect(result.checked).toBe(1);
			expect(result.staleFound).toBe(1);
		});

		it("does not flag an entity whose file_paths is empty", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-docs-nopaths", tmpDir);

			await insertEntity(db, {
				type: "Convention",
				name: "NoPaths",
				content: "content",
				summary: "summary",
				trust_tier: 1,
				file_paths: "[]",
			});

			const result = await validateDocumentation(db, tmpDir);
			expect(result.checked).toBe(0);
			expect(result.staleFound).toBe(0);
		});
	});

	// ─── identifyLowConfidenceClaims ────────────────────────────────────────

	describe("identifyLowConfidenceClaims", () => {
		it("returns zeros for an empty database", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-claims-empty", tmpDir);

			const result = await identifyLowConfidenceClaims(db);
			expect(result.verified).toBe(0);
			expect(result.invalidated).toBe(0);
			expect(result.confirmed).toBe(0);
		});

		it("finds lowest-confidence tier-3 entities up to maxClaims", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-claims-find", tmpDir);

			// Insert 5 entities with very low confidence
			for (let i = 0; i < 5; i++) {
				await insertEntity(db, {
					type: "Decision",
					name: `LowConf ${i}`,
					content: `content ${i}`,
					summary: `summary ${i}`,
					trust_tier: 3,
					confidence: 0.01 + i * 0.005,
				});
			}

			const result = await identifyLowConfidenceClaims(db, 3);

			// Should process at most 3 claims
			expect(result.verified).toBeLessThanOrEqual(3);
			expect(result.verified).toBeGreaterThan(0);
			expect(result.invalidated + result.confirmed).toBe(result.verified);
		});

		it("does not touch tier-1 or tier-2 entities", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-claims-tiers", tmpDir);

			await insertEntity(db, {
				type: "Decision",
				name: "UserStated",
				content: "content",
				summary: "summary",
				trust_tier: 1,
				confidence: 0.01, // very low, but tier 1
			});

			const result = await identifyLowConfidenceClaims(db);
			expect(result.verified).toBe(0);
		});

		it("marks entity as invalidated when source file is deleted", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-claims-deleted", tmpDir);

			// Insert entity pointing to a nonexistent file
			await insertEntity(db, {
				type: "Decision",
				name: "DeletedSource",
				content: "content",
				summary: "summary",
				trust_tier: 3,
				confidence: 0.05,
				file_paths: JSON.stringify(["/tmp/nonexistent-sia-file-12345.ts"]),
			});

			const result = await identifyLowConfidenceClaims(db, 5);
			expect(result.verified).toBe(1);
			expect(result.invalidated).toBe(1);
			expect(result.confirmed).toBe(0);
		});

		it("marks entity as confirmed when source file still exists", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-claims-exists", tmpDir);

			const sourceFile = join(tmpDir, "source.ts");
			writeFileSync(sourceFile, "export const x = 1;");

			await insertEntity(db, {
				type: "Decision",
				name: "ExistingSource",
				content: "content",
				summary: "summary",
				trust_tier: 3,
				confidence: 0.05,
				file_paths: JSON.stringify([sourceFile]),
			});

			const result = await identifyLowConfidenceClaims(db, 5);
			expect(result.verified).toBe(1);
			expect(result.confirmed).toBe(1);
			expect(result.invalidated).toBe(0);
		});

		it("marks entity as confirmed when file_paths is empty (no file to check)", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-claims-empty-paths", tmpDir);

			await insertEntity(db, {
				type: "Decision",
				name: "NoFile",
				content: "content",
				summary: "summary",
				trust_tier: 3,
				confidence: 0.05,
				file_paths: "[]",
			});

			const result = await identifyLowConfidenceClaims(db, 5);
			expect(result.verified).toBe(1);
			expect(result.confirmed).toBe(1);
			expect(result.invalidated).toBe(0);
		});
	});

	// ─── recomputePageRank ──────────────────────────────────────────────────

	describe("recomputePageRank", () => {
		it("returns nodesScored=0 for an empty database", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-pr-empty", tmpDir);

			const result = await recomputePageRank(db);
			expect(result.nodesScored).toBe(0);
		});

		it("updates importance scores for entities with edges", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-pr-edges", tmpDir);

			const nodeA = await insertEntity(db, {
				type: "CodeEntity",
				name: "NodeA",
				content: "function a",
				summary: "a",
				importance: 0.1,
			});
			const nodeB = await insertEntity(db, {
				type: "CodeEntity",
				name: "NodeB",
				content: "function b",
				summary: "b",
				importance: 0.1,
			});

			// Insert a calls edge from B to A
			const now = Date.now();
			await db.execute(
				`INSERT INTO graph_edges (id, from_id, to_id, type, weight, confidence, trust_tier, t_created)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[randomUUID(), nodeB.id, nodeA.id, "calls", 1.0, 0.8, 2, now],
			);

			const result = await recomputePageRank(db);
			expect(result.nodesScored).toBe(2);

			// After PageRank, NodeA should have higher importance since it's the target
			const { rows } = await db.execute(
				"SELECT id, importance FROM graph_nodes WHERE id IN (?, ?)",
				[nodeA.id, nodeB.id],
			);
			const importanceMap = new Map(rows.map((r) => [r.id as string, r.importance as number]));
			// NodeA (incoming calls) should have higher PageRank than NodeB
			expect(importanceMap.get(nodeA.id)).toBeGreaterThan(importanceMap.get(nodeB.id) as number);
		});
	});

	// ─── compactVersions ────────────────────────────────────────────────────

	describe("compactVersions", () => {
		it("returns compacted=0 for an empty database", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-compact-empty", tmpDir);

			const result = await compactVersions(db);
			expect(result.compacted).toBe(0);
			expect(result.ftsOptimized).toBe(true);
		});

		it("deletes archived entities older than retentionDays", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-compact-old", tmpDir);

			const retentionDays = 90;
			const retentionMs = retentionDays * 86_400_000;

			// Insert entity archived 100 days ago (beyond retention)
			const entity = await insertEntity(db, {
				type: "Concept",
				name: "OldArchived",
				content: "content",
				summary: "summary",
			});
			const oldArchivedAt = Date.now() - retentionMs - 10 * 86_400_000;
			await db.execute("UPDATE graph_nodes SET archived_at = ? WHERE id = ?", [
				oldArchivedAt,
				entity.id,
			]);

			const result = await compactVersions(db, { retentionDays });
			expect(result.compacted).toBeGreaterThanOrEqual(1);

			// The entity should be hard-deleted
			const { rows } = await db.execute("SELECT id FROM graph_nodes WHERE id = ?", [entity.id]);
			expect(rows.length).toBe(0);
		});

		it("does NOT delete recently archived entities still within retention window", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-compact-recent", tmpDir);

			const retentionDays = 90;

			// Insert entity archived 10 days ago (within retention)
			const entity = await insertEntity(db, {
				type: "Concept",
				name: "RecentArchived",
				content: "content",
				summary: "summary",
			});
			const recentArchivedAt = Date.now() - 10 * 86_400_000;
			await db.execute("UPDATE graph_nodes SET archived_at = ? WHERE id = ?", [
				recentArchivedAt,
				entity.id,
			]);

			const result = await compactVersions(db, { retentionDays });
			expect(result.compacted).toBe(0);

			// Entity should still exist
			const { rows } = await db.execute("SELECT id FROM graph_nodes WHERE id = ?", [entity.id]);
			expect(rows.length).toBe(1);
		});

		it("does NOT delete active (non-archived) entities", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-compact-active", tmpDir);

			const entity = await insertEntity(db, {
				type: "Concept",
				name: "ActiveEntity",
				content: "content",
				summary: "summary",
			});

			const result = await compactVersions(db, { retentionDays: 1 }); // aggressive retention
			expect(result.compacted).toBe(0);

			// Entity should still exist (no archived_at set)
			const { rows } = await db.execute("SELECT id FROM graph_nodes WHERE id = ?", [entity.id]);
			expect(rows.length).toBe(1);
		});

		it("optimizes FTS5 and sets ftsOptimized=true", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("deepval-compact-fts", tmpDir);

			const result = await compactVersions(db);
			expect(result.ftsOptimized).toBe(true);
		});
	});
});
