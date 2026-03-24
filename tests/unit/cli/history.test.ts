import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { insertEntity } from "@/graph/entities";

describe("sia history", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
		if (db) await db.close();
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should return entities created within a time range", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("history-test", tmpDir);

		const now = Date.now();
		const dayAgo = now - 86400000;
		const weekAgo = now - 604800000;

		await insertEntity(db, {
			type: "Decision", name: "Recent Decision", content: "test", summary: "test",
			created_at: dayAgo,
		});
		await insertEntity(db, {
			type: "Convention", name: "Old Convention", content: "test", summary: "test",
			created_at: weekAgo,
		});

		const { getHistory } = await import("@/cli/commands/history");
		const history = await getHistory(db, { since: dayAgo - 1000, until: now });

		expect(history.entities.length).toBeGreaterThanOrEqual(1);
		// Recent decision should be included
		const recent = history.entities.find((e: any) => e.name === "Recent Decision");
		expect(recent).toBeDefined();
	});

	it("should filter by entity type", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("history-filter", tmpDir);

		await insertEntity(db, { type: "Decision", name: "D1", content: "test", summary: "test" });
		await insertEntity(db, { type: "Bug", name: "B1", content: "test", summary: "test" });

		const { getHistory } = await import("@/cli/commands/history");
		const history = await getHistory(db, { types: ["Decision"] });

		const decisions = history.entities.filter((e: any) => e.type === "Decision");
		const bugs = history.entities.filter((e: any) => e.type === "Bug");
		expect(decisions.length).toBeGreaterThanOrEqual(1);
		expect(bugs.length).toBe(0);
	});
});
