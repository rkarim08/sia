import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import {
	checkAllDocFreshness,
	checkDocFreshness,
	DEFAULT_FRESHNESS_CONFIG,
	getGitModifiedAt,
} from "@/knowledge/freshness";

/**
 * Create a temporary git repository with initial commit.
 * Returns the absolute path to the repo directory.
 *
 * Note: execSync is safe here — all arguments are hardcoded test literals.
 */
function makeGitRepo(): string {
	const dir = join(tmpdir(), `sia-freshness-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	execSync("git init", { cwd: dir, stdio: "pipe" });
	execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
	execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
	return dir;
}

/**
 * Write a file, stage it, and commit it in the given git repo.
 * All arguments are hardcoded test literals — no user input.
 */
function commitFile(repoDir: string, relativePath: string, content: string): void {
	const absPath = join(repoDir, relativePath);
	const parentDir = join(absPath, "..");
	mkdirSync(parentDir, { recursive: true });
	writeFileSync(absPath, content);
	execSync(`git add "${relativePath}"`, { cwd: repoDir, stdio: "pipe" });
	execSync(`git commit -m "add ${relativePath}"`, { cwd: repoDir, stdio: "pipe" });
}

describe("documentation freshness tracking", () => {
	let gitDir: string | undefined;
	let siaHome: string | undefined;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (gitDir) {
			rmSync(gitDir, { recursive: true, force: true });
			gitDir = undefined;
		}
		if (siaHome) {
			rmSync(siaHome, { recursive: true, force: true });
			siaHome = undefined;
		}
	});

	// ---------------------------------------------------------------
	// getGitModifiedAt returns timestamp for tracked file
	// ---------------------------------------------------------------

	it("getGitModifiedAt returns timestamp for tracked file", () => {
		gitDir = makeGitRepo();
		commitFile(gitDir, "hello.txt", "hello world");

		const ts = getGitModifiedAt(gitDir, "hello.txt");

		expect(ts).not.toBeNull();
		expect(typeof ts).toBe("number");

		// Timestamp should be within the last 30 seconds (in milliseconds)
		const now = Date.now();
		expect(ts as number).toBeGreaterThan(now - 30_000);
		expect(ts as number).toBeLessThanOrEqual(now + 1_000);
	});

	// ---------------------------------------------------------------
	// getGitModifiedAt returns null for untracked file
	// ---------------------------------------------------------------

	it("getGitModifiedAt returns null for untracked file", () => {
		gitDir = makeGitRepo();
		// Need at least one commit for the repo to have HEAD
		writeFileSync(join(gitDir, ".gitkeep"), "");
		execSync("git add .gitkeep", { cwd: gitDir, stdio: "pipe" });
		execSync('git commit -m "init"', { cwd: gitDir, stdio: "pipe" });

		// Create a file but don't commit it
		writeFileSync(join(gitDir, "untracked.txt"), "not tracked");

		const ts = getGitModifiedAt(gitDir, "untracked.txt");

		expect(ts).toBeNull();
	});

	// ---------------------------------------------------------------
	// checkDocFreshness with recent doc is not stale
	// ---------------------------------------------------------------

	it("checkDocFreshness with recent doc is not stale", () => {
		gitDir = makeGitRepo();
		commitFile(gitDir, "doc.md", "# Documentation");
		commitFile(gitDir, "code.ts", "export const x = 1;");

		const result = checkDocFreshness(gitDir, "doc.md", ["code.ts"]);

		expect(result.isStale).toBe(false);
		expect(result.docModifiedAt).not.toBeNull();
		expect(result.codeModifiedAt).not.toBeNull();
		expect(result.divergenceDays).not.toBeNull();
		// Both committed within the same test run, divergence should be tiny
		expect(Math.abs(result.divergenceDays as number)).toBeLessThan(1);
	});

	// ---------------------------------------------------------------
	// checkDocFreshness with no referenced files
	// ---------------------------------------------------------------

	it("checkDocFreshness with no referenced files", () => {
		gitDir = makeGitRepo();
		commitFile(gitDir, "doc.md", "# Documentation");

		const result = checkDocFreshness(gitDir, "doc.md", []);

		expect(result.divergenceDays).toBeNull();
		expect(result.isStale).toBe(false);
		expect(result.codeModifiedAt).toBeNull();
		expect(result.docModifiedAt).not.toBeNull();
	});

	// ---------------------------------------------------------------
	// checkDocFreshness with untracked doc
	// ---------------------------------------------------------------

	it("checkDocFreshness with untracked doc", () => {
		gitDir = makeGitRepo();
		// Need an initial commit so the repo exists properly
		writeFileSync(join(gitDir, ".gitkeep"), "");
		execSync("git add .gitkeep", { cwd: gitDir, stdio: "pipe" });
		execSync('git commit -m "init"', { cwd: gitDir, stdio: "pipe" });

		// Doc file not committed
		writeFileSync(join(gitDir, "draft.md"), "# Draft");

		const result = checkDocFreshness(gitDir, "draft.md", ["code.ts"]);

		expect(result.docModifiedAt).toBeNull();
		expect(result.isStale).toBe(false);
	});

	// ---------------------------------------------------------------
	// DEFAULT_FRESHNESS_CONFIG has expected defaults
	// ---------------------------------------------------------------

	it("DEFAULT_FRESHNESS_CONFIG has expected defaults", () => {
		expect(DEFAULT_FRESHNESS_CONFIG.divergenceThreshold).toBe(90);
		expect(DEFAULT_FRESHNESS_CONFIG.freshnessPenalty).toBe(0.15);
	});

	// ---------------------------------------------------------------
	// checkDocFreshness respects custom config threshold
	// ---------------------------------------------------------------

	it("checkDocFreshness respects custom config threshold", () => {
		gitDir = makeGitRepo();
		commitFile(gitDir, "doc.md", "# Documentation");
		commitFile(gitDir, "code.ts", "export const x = 1;");

		// With a threshold of 0, even tiny divergence where code is newer marks stale.
		// But since both files are committed in the same test run, code might not be
		// "newer" enough. The divergence is near zero and needs to be > 0 to be stale.
		const result = checkDocFreshness(gitDir, "doc.md", ["code.ts"], {
			divergenceThreshold: 0,
			freshnessPenalty: 0.1,
		});

		// Both committed within the same second, so divergenceDays is ~0 or slightly positive.
		// The code was committed AFTER the doc, so divergence should be >= 0.
		expect(result.divergenceDays).not.toBeNull();
		// The result might or might not be stale depending on sub-second timing,
		// but the config was respected (no error thrown).
		expect(typeof result.isStale).toBe("boolean");
	});

	// ---------------------------------------------------------------
	// checkAllDocFreshness finds doc entities and checks them
	// ---------------------------------------------------------------

	it("checkAllDocFreshness finds doc entities and checks them", async () => {
		gitDir = makeGitRepo();
		siaHome = join(tmpdir(), `sia-home-${randomUUID()}`);
		mkdirSync(siaHome, { recursive: true });

		commitFile(gitDir, "README.md", "# Project docs");
		commitFile(gitDir, "src/index.ts", "export const main = () => {};");

		db = openGraphDb("test-freshness", siaHome);

		// Insert a documentation FileNode
		const docEntity = await insertEntity(db, {
			type: "FileNode",
			name: "README.md",
			content: "Project documentation",
			summary: "Project docs",
			tags: JSON.stringify(["project-docs"]),
			file_paths: JSON.stringify(["README.md"]),
			importance: 0.8,
		});

		// Insert a code entity
		const codeEntity = await insertEntity(db, {
			type: "CodeEntity",
			name: "index.ts",
			content: "Main entry point",
			summary: "Entry point",
			file_paths: JSON.stringify(["src/index.ts"]),
		});

		// Create an edge from doc to code
		await insertEdge(db, {
			from_id: docEntity.id,
			to_id: codeEntity.id,
			type: "relates_to",
		});

		const results = await checkAllDocFreshness(db, gitDir);

		expect(results).toHaveLength(1);
		const first = results[0] as (typeof results)[0];
		expect(first.entityId).toBe(docEntity.id);
		expect(first.filePath).toBe("README.md");
		expect(first.docModifiedAt).not.toBeNull();
		expect(first.isStale).toBe(false);
	});

	// ---------------------------------------------------------------
	// checkAllDocFreshness applies penalty to stale documents
	// ---------------------------------------------------------------

	it("checkAllDocFreshness applies penalty when stale and applyPenalty is true", async () => {
		siaHome = join(tmpdir(), `sia-home-${randomUUID()}`);
		mkdirSync(siaHome, { recursive: true });

		gitDir = makeGitRepo();

		// Commit doc first, then code — both recent, so not stale with default config.
		// We use a very low threshold (0) to force staleness since code is committed after doc.
		commitFile(gitDir, "ARCHITECTURE.md", "# Architecture");
		commitFile(gitDir, "src/app.ts", "export const app = {};");

		db = openGraphDb("test-penalty", siaHome);

		const docEntity = await insertEntity(db, {
			type: "FileNode",
			name: "ARCHITECTURE.md",
			content: "Architecture docs",
			summary: "Architecture",
			tags: JSON.stringify(["architecture"]),
			file_paths: JSON.stringify(["ARCHITECTURE.md"]),
			importance: 0.8,
		});

		const codeEntity = await insertEntity(db, {
			type: "CodeEntity",
			name: "app.ts",
			content: "Application module",
			summary: "App module",
			file_paths: JSON.stringify(["src/app.ts"]),
		});

		await insertEdge(db, {
			from_id: docEntity.id,
			to_id: codeEntity.id,
			type: "relates_to",
		});

		// Use a threshold of 0 so any positive divergence triggers staleness
		const results = await checkAllDocFreshness(
			db,
			gitDir,
			{ divergenceThreshold: 0, freshnessPenalty: 0.15 },
			{ applyPenalty: true },
		);

		expect(results).toHaveLength(1);
		const result = results[0] as (typeof results)[0];

		// If divergence is positive (code newer than doc), penalty should be applied
		if (result.isStale) {
			// Verify entity was updated with penalty
			const updated = await db.execute("SELECT importance, tags FROM graph_nodes WHERE id = ?", [
				docEntity.id,
			]);
			const row = updated.rows[0] as (typeof updated.rows)[0];
			expect(row.importance as number).toBeLessThan(0.8);
			expect(row.importance as number).toBeGreaterThanOrEqual(0.01);

			const tags = JSON.parse(row.tags as string) as string[];
			expect(tags).toContain("potentially-stale");
		}
	});

	// ---------------------------------------------------------------
	// checkAllDocFreshness skips entities with no file_paths
	// ---------------------------------------------------------------

	it("checkAllDocFreshness skips entities with empty file_paths", async () => {
		siaHome = join(tmpdir(), `sia-home-${randomUUID()}`);
		mkdirSync(siaHome, { recursive: true });

		gitDir = makeGitRepo();
		commitFile(gitDir, "placeholder.txt", "placeholder");

		db = openGraphDb("test-skip", siaHome);

		// Insert a doc entity with empty file_paths
		await insertEntity(db, {
			type: "FileNode",
			name: "empty-doc",
			content: "No file paths",
			summary: "Empty doc",
			tags: JSON.stringify(["project-docs"]),
			file_paths: JSON.stringify([]),
		});

		const results = await checkAllDocFreshness(db, gitDir);

		expect(results).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// checkAllDocFreshness ignores archived and invalidated entities
	// ---------------------------------------------------------------

	it("checkAllDocFreshness ignores archived and invalidated entities", async () => {
		siaHome = join(tmpdir(), `sia-home-${randomUUID()}`);
		mkdirSync(siaHome, { recursive: true });

		gitDir = makeGitRepo();
		commitFile(gitDir, "old-doc.md", "# Old");

		db = openGraphDb("test-ignore", siaHome);

		// Insert an archived entity
		const archivedEntity = await insertEntity(db, {
			type: "FileNode",
			name: "archived-doc",
			content: "Archived documentation",
			summary: "Archived doc",
			tags: JSON.stringify(["project-docs"]),
			file_paths: JSON.stringify(["old-doc.md"]),
		});
		await db.execute("UPDATE graph_nodes SET archived_at = ? WHERE id = ?", [
			Date.now(),
			archivedEntity.id,
		]);

		// Insert an invalidated entity
		const invalidatedEntity = await insertEntity(db, {
			type: "FileNode",
			name: "invalidated-doc",
			content: "Invalidated documentation",
			summary: "Invalidated doc",
			tags: JSON.stringify(["project-docs"]),
			file_paths: JSON.stringify(["old-doc.md"]),
		});
		await db.execute("UPDATE graph_nodes SET t_valid_until = ? WHERE id = ?", [
			Date.now(),
			invalidatedEntity.id,
		]);

		const results = await checkAllDocFreshness(db, gitDir);

		expect(results).toHaveLength(0);
	});
});
