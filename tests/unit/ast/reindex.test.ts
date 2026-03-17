import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { siaReindex } from "@/cli/commands/reindex";
import { openGraphDb } from "@/graph/semantic-db";

describe("siaReindex", () => {
	let repoRoot: string;
	let siaHome: string;
	let repoHash: string;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "sia-reindex-repo-"));
		siaHome = mkdtempSync(join(tmpdir(), "sia-reindex-home-"));
		mkdirSync(join(repoRoot, ".git"));
		repoHash = createHash("sha256").update(resolve(repoRoot)).digest("hex");
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
		rmSync(siaHome, { recursive: true, force: true });
	});

	it("runs in dry-run mode without writing entities", async () => {
		mkdirSync(join(repoRoot, "src"), { recursive: true });
		writeFileSync(join(repoRoot, "src", "dry.ts"), "export function dry() {}", "utf-8");

		// Override ast cache to temp home
		writeFileSync(
			join(siaHome, "config.json"),
			JSON.stringify(
				{
					astCacheDir: join(siaHome, "ast-cache"),
				},
				null,
				2,
			),
			"utf-8",
		);

		const result = await siaReindex({ cwd: repoRoot, siaHome, dryRun: true });
		expect(result.dryRun).toBe(true);
		expect(result.repoHash).toBe(repoHash);
		const db = openGraphDb(repoHash, siaHome);
		const rows = await db.execute("SELECT COUNT(*) as count FROM entities");
		await db.close();
		expect(rows.rows[0]?.count).toBe(0);
	});

	it("writes entities and cache when not in dry-run mode", async () => {
		mkdirSync(join(repoRoot, "src"), { recursive: true });
		writeFileSync(join(repoRoot, "src", "live.ts"), "export function live() {}", "utf-8");

		writeFileSync(
			join(siaHome, "config.json"),
			JSON.stringify(
				{
					astCacheDir: join(siaHome, "ast-cache"),
				},
				null,
				2,
			),
			"utf-8",
		);

		const result = await siaReindex({ cwd: repoRoot, siaHome });
		expect(result.entitiesCreated).toBeGreaterThan(0);

		const db = openGraphDb(repoHash, siaHome);
		const rows = await db.execute("SELECT COUNT(*) as count FROM entities");
		await db.close();
		expect(rows.rows[0]?.count).toBeGreaterThan(0);

		const cachePath = join(siaHome, "ast-cache", repoHash, "index-cache.json");
		expect(existsSync(cachePath)).toBe(true);
		expect(readFileSync(cachePath, "utf-8").length).toBeGreaterThan(0);
	});

	it("throws when no .git directory found", async () => {
		const noGitDir = mkdtempSync(join(tmpdir(), "sia-reindex-nogit-"));
		try {
			await expect(siaReindex({ cwd: noGitDir, siaHome })).rejects.toThrow(
				/No .git directory/,
			);
		} finally {
			rmSync(noGitDir, { recursive: true, force: true });
		}
	});
});
