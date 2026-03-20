import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-migration-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("006_tree_sitter migration", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("adds extraction_backend column to graph_nodes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-migration", tmpDir);
		const result = await db.execute(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='graph_nodes'",
		);
		const schema = (result.rows[0] as Record<string, unknown>).sql as string;
		expect(schema).toContain("extraction_backend");
	});
});
