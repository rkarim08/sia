import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexRepository } from "@/ast/indexer";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import type { SiaConfig } from "@/shared/config";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-ts-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("indexRepository with tree-sitter", () => {
	let tmpDir: string;
	let repoDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("indexes a TypeScript file and creates entities", async () => {
		tmpDir = makeTmp();
		repoDir = join(tmpDir, "repo");
		mkdirSync(repoDir, { recursive: true });
		writeFileSync(
			join(repoDir, "hello.ts"),
			'export function hello() { return "world"; }\nexport class Greeter {}\n',
		);
		db = openGraphDb("test-ts-idx", tmpDir);
		const config = {
			repoDir,
			astCacheDir: join(tmpDir, "cache"),
			excludePaths: [],
		} as unknown as SiaConfig;
		const result = await indexRepository(repoDir, db, config, { repoHash: "test-ts-idx" });
		expect(result.filesProcessed).toBe(1);
		expect(result.entitiesCreated).toBeGreaterThanOrEqual(2);
	});
});
