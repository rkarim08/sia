import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

describe("sia tour", () => {
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

	it("should generate a tour summary", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("tour-test", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "D1",
			content: "test decision",
			summary: "test decision",
		});
		await insertEntity(db, {
			type: "Convention",
			name: "C1",
			content: "test convention",
			summary: "test convention",
		});
		await insertEntity(db, {
			type: "CodeEntity",
			name: "E1",
			content: "function foo()",
			summary: "function foo",
		});

		const { generateTour } = await import("@/cli/commands/tour");
		const tour = await generateTour(db);

		expect(tour.sections.length).toBeGreaterThan(0);
		expect(tour.totalEntities).toBe(3);
	});
});
