import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexRepository } from "@/ast/indexer";
import { createWatcher } from "@/ast/watcher";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { DEFAULT_CONFIG, type SiaConfig } from "@/shared/config";

async function waitForCondition(
	check: () => Promise<boolean>,
	timeoutMs = 5000,
	intervalMs = 50,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error("Condition not met within timeout");
}

describe("createWatcher", () => {
	let repoRoot: string;
	let siaHome: string;
	let repoHash: string;
	let config: SiaConfig;
	let db: SiaDb;

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
		await watcher.ready;

		mkdirSync(join(repoRoot, "src"), { recursive: true });
		writeFileSync(join(repoRoot, "src", "watch.ts"), "export function watchMe() {}", "utf-8");

		await waitForCondition(async () => {
			const rows = await db.execute("SELECT name FROM entities WHERE name = ?", ["watchMe"]);
			return rows.rows.length >= 1;
		});

		await watcher.stop();

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
		await watcher.ready;
		rmSync(filePath);

		await waitForCondition(async () => {
			const rows = await db.execute(
				"SELECT t_valid_until FROM entities WHERE name = ? ORDER BY t_created DESC LIMIT 1",
				["doomed"],
			);
			return rows.rows[0]?.t_valid_until !== null && rows.rows[0]?.t_valid_until !== undefined;
		});

		await watcher.stop();

		const rows = await db.execute(
			"SELECT t_valid_until FROM entities WHERE name = ? ORDER BY t_created DESC LIMIT 1",
			["doomed"],
		);
		expect(rows.rows[0]?.t_valid_until).not.toBeNull();
	});

	it("handles file rename (delete + add)", async () => {
		mkdirSync(join(repoRoot, "src"), { recursive: true });
		const oldPath = join(repoRoot, "src", "old-name.ts");
		writeFileSync(oldPath, "export function renamed() {}", "utf-8");
		await indexRepository(repoRoot, db, config, { repoHash });

		const watcher = createWatcher(repoRoot, db, config);
		watcher.start();
		await watcher.ready;

		rmSync(oldPath);
		writeFileSync(join(repoRoot, "src", "new-name.ts"), "export function renamed() {}", "utf-8");

		await waitForCondition(async () => {
			const rows = await db.execute(
				"SELECT COUNT(*) as cnt FROM entities WHERE name = 'renamed' AND t_valid_until IS NULL",
			);
			return (rows.rows[0]?.cnt as number) >= 1;
		});

		await watcher.stop();
	});
});
