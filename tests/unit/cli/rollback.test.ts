import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listAvailableSnapshots, rollbackGraph } from "@/cli/commands/rollback";
import type { SiaDb } from "@/graph/db-interface";
import { getActiveEntities, insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { createSnapshot } from "@/graph/snapshots";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("rollback", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// rollbackGraph restores from most recent snapshot
	// ---------------------------------------------------------------

	it("rollbackGraph restores from most recent snapshot", async () => {
		tmpDir = makeTmp();
		const repoHash = "rollback-recent";
		db = openGraphDb(repoHash, tmpDir);

		// Insert entity and create a snapshot
		await insertEntity(db, {
			type: "Concept",
			name: "Original Entity",
			content: "This entity exists before snapshot",
			summary: "Original",
		});

		await createSnapshot(db, repoHash, tmpDir);

		// Insert another entity (2 total now)
		await insertEntity(db, {
			type: "Decision",
			name: "Second Entity",
			content: "This entity was added after the snapshot",
			summary: "Second",
		});

		// Verify 2 entities exist before rollback
		const beforeRollback = await getActiveEntities(db);
		expect(beforeRollback).toHaveLength(2);

		// Rollback with no target = use most recent snapshot
		await rollbackGraph(db, repoHash, { siaHome: tmpDir });

		// After rollback, should be back to 1 entity (the pre-snapshot state)
		const afterRollback = await getActiveEntities(db);
		expect(afterRollback).toHaveLength(1);
		expect(afterRollback[0]?.name).toBe("Original Entity");
	});

	// ---------------------------------------------------------------
	// rollbackGraph with target date finds nearest snapshot
	// ---------------------------------------------------------------

	it("rollbackGraph with target date finds nearest snapshot", async () => {
		tmpDir = makeTmp();
		const repoHash = "rollback-target";
		db = openGraphDb(repoHash, tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Target Date Entity",
			content: "Entity for target date test",
			summary: "Target date",
		});

		await createSnapshot(db, repoHash, tmpDir);

		// Rollback with a target timestamp of now (should find the snapshot we just created)
		await expect(
			rollbackGraph(db, repoHash, { target: Date.now(), siaHome: tmpDir }),
		).resolves.not.toThrow();
	});

	// ---------------------------------------------------------------
	// throws when no snapshot found
	// ---------------------------------------------------------------

	it("throws when no snapshot found", async () => {
		tmpDir = makeTmp();
		const repoHash = "rollback-no-snap";
		db = openGraphDb(repoHash, tmpDir);

		// No snapshots exist — rollback with a far-past date should throw
		await expect(rollbackGraph(db, repoHash, { target: 0, siaHome: tmpDir })).rejects.toThrow(
			"No snapshot found",
		);
	});

	// ---------------------------------------------------------------
	// listAvailableSnapshots returns snapshot list
	// ---------------------------------------------------------------

	it("listAvailableSnapshots returns snapshot list", async () => {
		tmpDir = makeTmp();
		const repoHash = "rollback-list";
		db = openGraphDb(repoHash, tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "List Snapshot Entity",
			content: "Entity for list test",
			summary: "List entity",
		});

		await createSnapshot(db, repoHash, tmpDir);

		const snapshots = listAvailableSnapshots(repoHash, tmpDir);
		expect(snapshots.length).toBeGreaterThanOrEqual(1);
		expect(snapshots[0]).toContain(".snapshot");
	});
});
