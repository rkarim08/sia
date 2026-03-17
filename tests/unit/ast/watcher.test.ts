import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexRepository } from "@/ast/indexer";
import { createWatcher } from "@/ast/watcher";
import { openGraphDb } from "@/graph/semantic-db";
import { DEFAULT_CONFIG, type SiaConfig } from "@/shared/config";

describe("createWatcher", () => {
	let repoRoot: string;
	let siaHome: string;
	let repoHash: string;
	let config: SiaConfig;
	let db: ReturnType<typeof openGraphDb>;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "sia-watcher-repo-"));
		siaHome = mkdtempSync(join(tmpdir(), "sia-watcher-home-"));
		mkdirSync(join(repoRoot, ".git"));
		repoHash = createHash("sha256").update(resolve(repoRoot)).digest("hex");
		config = {
			...DEFAULT_CONFIG,
			repoDir: join(siaHome, "repos"),
			astCacheDir: join(siaHome, "ast-cache"),
		};
		db = openGraphDb(repoHash, siaHome);
	});

	afterEach(async () => {
		await db.close();
		rmSync(repoRoot, { recursive: true, force: true });
		rmSync(siaHome, { recursive: true, force: true });
	});

	it("creates CodeEntity when file is added", async () => {
		const watcher = createWatcher(repoRoot, db, config);
		watcher.start();
		await (watcher as unknown as { ready: Promise<void> }).ready;

		mkdirSync(join(repoRoot, "src"), { recursive: true });
		writeFileSync(join(repoRoot, "src", "watch.ts"), "export function watchMe() {}", "utf-8");

		await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
		watcher.stop();

		const rows = await db.execute("SELECT name FROM entities WHERE name = ?", ["watchMe"]);
		expect(rows.rows.length).toBe(1);
	});

	it("invalidates entities when file is deleted", async () => {
		mkdirSync(join(repoRoot, "src"), { recursive: true });
		const filePath = join(repoRoot, "src", "delete-me.ts");
		writeFileSync(filePath, "export function doomed() {}", "utf-8");
		await indexRepository(repoRoot, db, config, { repoHash });

		const watcher = createWatcher(repoRoot, db, config);
		watcher.start();
		await (watcher as unknown as { ready: Promise<void> }).ready;
		rmSync(filePath);

		await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
		watcher.stop();

		const rows = await db.execute(
			"SELECT t_valid_until FROM entities WHERE name = ? ORDER BY t_created DESC LIMIT 1",
			["doomed"],
		);
		expect(rows.rows[0]?.t_valid_until).not.toBeNull();
	});
});
