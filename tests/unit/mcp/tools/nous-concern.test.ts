import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v4 as uuid } from "uuid";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleNousConcern } from "@/mcp/tools/nous-concern";

function makeTmp(): string {
	return join(tmpdir(), `nous-cn-${randomUUID()}`);
}

function insertConcern(db: SiaDb, id: string, name: string, tags: string): void {
	const raw = db.rawSqlite();
	if (!raw) throw new Error("no raw handle");
	const now = Date.now();
	raw
		.prepare(
			`INSERT INTO graph_nodes (
			id, type, name, content, summary,
			tags, file_paths,
			trust_tier, confidence, base_confidence,
			importance, base_importance,
			access_count, edge_count,
			last_accessed, created_at, t_created,
			visibility, created_by,
			kind
		) VALUES (?, 'Concern', ?, 'Content', 'Summary', ?, '[]', 3, 0.7, 0.7, 0.5, 0.5, 0, 0, ?, ?, ?, 'private', 'test', 'Concern')`,
		)
		.run(id, name, tags, now, now, now);
}

describe("nous-concern", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	it("returns empty list when no open concerns exist", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-cn1", tmpDir);

		const result = await handleNousConcern(db, {});
		expect(Array.isArray(result.concerns)).toBe(true);
		expect(result.concerns.length).toBe(0);
	});

	it("returns open Concern nodes and marks them surfaced", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-cn2", tmpDir);

		const id = uuid();
		insertConcern(db, id, "Test concern", "status:open");

		const result = await handleNousConcern(db, {});
		expect(result.concerns.length).toBe(1);
		expect(result.concerns[0].name).toBe("Test concern");

		// Verify the concern was flipped to surfaced.
		const raw = db.rawSqlite();
		const updated = raw!.prepare("SELECT tags FROM graph_nodes WHERE id = ?").get(id) as {
			tags: string;
		};
		expect(updated.tags).toContain("status:surfaced");
		expect(updated.tags).not.toContain("status:open");
	});

	it("does not return already-surfaced concerns", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-cn3", tmpDir);

		insertConcern(db, uuid(), "Already surfaced", "status:surfaced");

		const result = await handleNousConcern(db, {});
		expect(result.concerns.length).toBe(0);
	});
});
