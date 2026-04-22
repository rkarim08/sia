import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { getEmptyGraphHint, type HintDb } from "@/hooks/session-start-hints";

function makeTmp() {
	return join(tmpdir(), `sia-session-start-${randomUUID()}`);
}

describe("getEmptyGraphHint", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	it("emits the /sia-setup hint when the graph has zero active entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-empty", tmpDir);

		const hint = await getEmptyGraphHint(db);
		expect(hint).toContain("No graph detected");
		expect(hint).toContain("/sia-setup");
	});

	it("does NOT emit the hint when the graph contains at least one active entity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-populated", tmpDir);

		// Seed one active node so the graph is non-empty. insertEntity
		// sets archived_at=null by default, which is what the hint filters on.
		await insertEntity(db, {
			type: "Concept",
			name: "Test Entity",
			content: "seed row so the graph is non-empty",
			summary: "seed",
		});

		const hint = await getEmptyGraphHint(db);
		expect(hint).toBe("");
	});

	it("returns an empty string (no throw, no hint) when graph_nodes table is missing", async () => {
		// Fake a db handle that reports the table doesn't exist.
		const fakeDb: HintDb = {
			execute: async (sql: string) => {
				if (sql.includes("sqlite_master")) {
					return { rows: [] };
				}
				throw new Error("graph_nodes should not be queried when the table is missing");
			},
		};

		let hint: string | undefined;
		await expect(
			(async () => {
				hint = await getEmptyGraphHint(fakeDb);
			})(),
		).resolves.toBeUndefined();
		expect(hint).toBe("");
	});
});
