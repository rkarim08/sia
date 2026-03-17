import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { siaInstall } from "@/cli/commands/install";

describe("siaInstall", () => {
	let tempCwd: string;
	let tempSiaHome: string;

	beforeEach(() => {
		tempCwd = mkdtempSync(join(tmpdir(), "sia-install-cwd-"));
		tempSiaHome = mkdtempSync(join(tmpdir(), "sia-install-home-"));
		// Create a fake .git directory so repo root detection works
		mkdirSync(join(tempCwd, ".git"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tempCwd, { recursive: true, force: true });
		rmSync(tempSiaHome, { recursive: true, force: true });
	});

	it("creates all 4 database files", async () => {
		const result = await siaInstall({ cwd: tempCwd, siaHome: tempSiaHome });
		const repoHash = result.repoHash;

		// graph.db and episodic.db under repos/{repoHash}/
		expect(existsSync(join(tempSiaHome, "repos", repoHash, "graph.db"))).toBe(true);
		expect(existsSync(join(tempSiaHome, "repos", repoHash, "episodic.db"))).toBe(true);

		// meta.db and bridge.db at sia home root
		expect(existsSync(join(tempSiaHome, "meta.db"))).toBe(true);
		expect(existsSync(join(tempSiaHome, "bridge.db"))).toBe(true);
	});

	it("registers repo in meta.db", async () => {
		const result = await siaInstall({ cwd: tempCwd, siaHome: tempSiaHome });

		// Re-open meta.db and check the repos table
		const { openMetaDb } = await import("@/graph/meta-db");
		const metaDb = openMetaDb(tempSiaHome);
		const rows = await metaDb.execute("SELECT * FROM repos WHERE id = ?", [result.repoHash]);
		await metaDb.close();

		expect(rows.rows).toHaveLength(1);
		expect(rows.rows[0]?.path).toBe(resolve(tempCwd));
	});

	it("writes default config", async () => {
		await siaInstall({ cwd: tempCwd, siaHome: tempSiaHome });

		const configPath = join(tempSiaHome, "config.json");
		expect(existsSync(configPath)).toBe(true);

		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(config).toBeDefined();
	});

	it("creates ast-cache directory", async () => {
		const result = await siaInstall({ cwd: tempCwd, siaHome: tempSiaHome });

		const astCacheDir = join(tempSiaHome, "ast-cache", result.repoHash);
		expect(existsSync(astCacheDir)).toBe(true);
	});

	it("is idempotent (second call does not fail)", async () => {
		const first = await siaInstall({ cwd: tempCwd, siaHome: tempSiaHome });
		const second = await siaInstall({ cwd: tempCwd, siaHome: tempSiaHome });

		expect(second.repoHash).toBe(first.repoHash);
		expect(second.dbsInitialized).toBe(true);
	});

	it("returns correct repoHash", async () => {
		const result = await siaInstall({ cwd: tempCwd, siaHome: tempSiaHome });

		const expected = createHash("sha256").update(resolve(tempCwd)).digest("hex");
		expect(result.repoHash).toBe(expected);
	});

	it("does not overwrite CLAUDE.md without end marker", async () => {
		const claudePath = join(tempCwd, "CLAUDE.md");
		writeFileSync(claudePath, "# My Custom Content\n", "utf-8");

		await siaInstall({ cwd: tempCwd, siaHome: tempSiaHome });

		const content = readFileSync(claudePath, "utf-8");
		expect(content).toBe("# My Custom Content\n");
	});

	it("throws when no .git directory is found", async () => {
		const noGitDir = mkdtempSync(join(tmpdir(), "sia-install-nogit-"));
		try {
			await expect(siaInstall({ cwd: noGitDir, siaHome: tempSiaHome })).rejects.toThrow(
				/No .git directory found/,
			);
		} finally {
			rmSync(noGitDir, { recursive: true, force: true });
		}
	});
});
