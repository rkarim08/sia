import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { insertEntity } from "@/graph/entities";

describe("sia compare", () => {
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

	it("should show entities added between two time points", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("compare-test", tmpDir);

		const t1 = Date.now() - 86400000; // 1 day ago
		const t2 = Date.now();

		// Entity created before t1
		await insertEntity(db, {
			type: "Decision", name: "Old Decision", content: "before", summary: "before",
			created_at: t1 - 1000,
		});
		// Entity created between t1 and t2
		await insertEntity(db, {
			type: "Convention", name: "New Convention", content: "after", summary: "after",
			created_at: t1 + 1000,
		});

		const { compareGraphState } = await import("@/cli/commands/compare");
		const diff = await compareGraphState(db, t1, t2);

		expect(diff.added.length).toBeGreaterThanOrEqual(1);
		expect(diff.added.find((e: any) => e.name === "New Convention")).toBeDefined();
	});
});
