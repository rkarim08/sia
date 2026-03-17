import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getStats } from "@/cli/commands/stats";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { archiveEntity, insertEntity, invalidateEntity } from "@/graph/entities";
import { openEpisodicDb, openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("stats", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;
	let epiDb: SiaDb | undefined;

	afterEach(async () => {
		if (epiDb) {
			await epiDb.close();
			epiDb = undefined;
		}
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// returns accurate entity counts by type
	// ---------------------------------------------------------------

	it("returns accurate entity counts by type", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("stats-by-type", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Concept 1",
			content: "First concept",
			summary: "Concept 1",
		});

		await insertEntity(db, {
			type: "Concept",
			name: "Concept 2",
			content: "Second concept",
			summary: "Concept 2",
		});

		await insertEntity(db, {
			type: "Decision",
			name: "Decision 1",
			content: "A decision",
			summary: "Decision 1",
		});

		const stats = await getStats(db);
		expect(stats.totalEntitiesByType).toEqual({
			Concept: 2,
			Decision: 1,
		});
	});

	// ---------------------------------------------------------------
	// counts archived and invalidated entities
	// ---------------------------------------------------------------

	it("counts archived and invalidated entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("stats-archived-invalidated", tmpDir);

		const _e1 = await insertEntity(db, {
			type: "Concept",
			name: "Active Entity",
			content: "This stays active",
			summary: "Active",
		});

		const e2 = await insertEntity(db, {
			type: "Concept",
			name: "Archived Entity",
			content: "This will be archived",
			summary: "Archived",
		});

		const e3 = await insertEntity(db, {
			type: "Concept",
			name: "Invalidated Entity",
			content: "This will be invalidated",
			summary: "Invalidated",
		});

		await archiveEntity(db, e2.id);
		await invalidateEntity(db, e3.id);

		const stats = await getStats(db);
		expect(stats.archivedCount).toBe(1);
		expect(stats.invalidatedCount).toBe(1);
		// Only the active entity should appear in totalEntitiesByType
		expect(stats.totalEntitiesByType).toEqual({ Concept: 1 });
	});

	// ---------------------------------------------------------------
	// counts active edges by type
	// ---------------------------------------------------------------

	it("counts active edges by type", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("stats-edges", tmpDir);

		const e1 = await insertEntity(db, {
			type: "Concept",
			name: "Source Entity",
			content: "Source",
			summary: "Source",
		});

		const e2 = await insertEntity(db, {
			type: "Concept",
			name: "Target Entity",
			content: "Target",
			summary: "Target",
		});

		await insertEdge(db, {
			from_id: e1.id,
			to_id: e2.id,
			type: "relates_to",
		});

		const stats = await getStats(db);
		expect(stats.activeEdgesByType).toEqual({ relates_to: 1 });
	});

	// ---------------------------------------------------------------
	// returns zero episode count without episodicDb
	// ---------------------------------------------------------------

	it("returns zero episode count without episodicDb", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("stats-no-episodic", tmpDir);

		const stats = await getStats(db);
		expect(stats.episodeCount).toBe(0);
	});

	// ---------------------------------------------------------------
	// counts episodes from episodicDb
	// ---------------------------------------------------------------

	it("counts episodes from episodicDb", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("stats-with-episodic", tmpDir);
		epiDb = openEpisodicDb("stats-with-episodic", tmpDir);

		// Insert an episode directly
		await epiDb.execute(
			`INSERT INTO episodes (id, session_id, ts, type, role, content, trust_tier)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[randomUUID(), "test-session", Date.now(), "conversation", "user", "Test episode content", 3],
		);

		const stats = await getStats(db, epiDb);
		expect(stats.episodeCount).toBe(1);
	});
});
