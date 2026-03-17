import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import {
	createSnapshot,
	findNearestSnapshot,
	listSnapshots,
	restoreSnapshot,
	type SnapshotData,
} from "@/graph/snapshots";

describe("snapshot rollback", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

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
	// 1. createSnapshot writes valid JSON file
	// ---------------------------------------------------------------

	it("createSnapshot writes valid JSON file", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("snap-create", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Snapshot Entity",
			content: "This entity should appear in the snapshot",
			summary: "Snap entity",
			created_by: "dev-1",
		});

		const snapshotPath = await createSnapshot(db, "snap-create", tmpDir);

		// File exists
		expect(existsSync(snapshotPath)).toBe(true);

		// Parses as valid JSON with correct shape
		const raw = readFileSync(snapshotPath, "utf-8");
		const data = JSON.parse(raw) as SnapshotData;

		expect(data.version).toBe(1);
		expect(data.timestamp).toBeGreaterThan(0);
		expect(Array.isArray(data.entities)).toBe(true);
		expect(data.entities).toHaveLength(1);
		expect(data.entities[0]?.name).toBe("Snapshot Entity");
		expect(Array.isArray(data.edges)).toBe(true);
	});

	// ---------------------------------------------------------------
	// 2. listSnapshots returns files sorted by date
	// ---------------------------------------------------------------

	it("listSnapshots returns files sorted by date", () => {
		tmpDir = makeTmp();
		const repoHash = "snap-list";
		const dir = join(tmpDir, "snapshots", repoHash);
		mkdirSync(dir, { recursive: true });

		// Create snapshot files out of order
		writeFileSync(join(dir, "2026-03-15.snapshot"), "{}", "utf-8");
		writeFileSync(join(dir, "2026-01-01.snapshot"), "{}", "utf-8");
		writeFileSync(join(dir, "2026-03-17.snapshot"), "{}", "utf-8");
		writeFileSync(join(dir, "2026-02-10.snapshot"), "{}", "utf-8");

		const snapshots = listSnapshots(repoHash, tmpDir);

		expect(snapshots).toHaveLength(4);
		// Sorted oldest to newest (alphabetical on YYYY-MM-DD)
		expect(snapshots[0]).toContain("2026-01-01.snapshot");
		expect(snapshots[1]).toContain("2026-02-10.snapshot");
		expect(snapshots[2]).toContain("2026-03-15.snapshot");
		expect(snapshots[3]).toContain("2026-03-17.snapshot");
	});

	// ---------------------------------------------------------------
	// 3. restoreSnapshot restores graph state
	// ---------------------------------------------------------------

	it("restoreSnapshot restores graph state", async () => {
		tmpDir = makeTmp();
		const repoHash = "snap-restore";
		db = openGraphDb(repoHash, tmpDir);

		// Insert 3 entities
		await insertEntity(db, {
			type: "Concept",
			name: "Entity Alpha",
			content: "Alpha content",
			summary: "Alpha",
			created_by: "dev-1",
		});
		await insertEntity(db, {
			type: "Decision",
			name: "Entity Beta",
			content: "Beta content",
			summary: "Beta",
			created_by: "dev-1",
		});
		await insertEntity(db, {
			type: "Bug",
			name: "Entity Gamma",
			content: "Gamma content",
			summary: "Gamma",
			created_by: "dev-1",
		});

		// Create snapshot
		const snapshotPath = await createSnapshot(db, repoHash, tmpDir);

		// Verify 3 entities exist
		const beforeDelete = await db.execute(
			"SELECT * FROM entities WHERE t_valid_until IS NULL AND archived_at IS NULL",
		);
		expect(beforeDelete.rows).toHaveLength(3);

		// Delete all entities
		await db.execute("DELETE FROM entities");
		const afterDelete = await db.execute("SELECT * FROM entities");
		expect(afterDelete.rows).toHaveLength(0);

		// Restore from snapshot
		await restoreSnapshot(db, snapshotPath, repoHash, tmpDir);

		// Verify 3 entities are back
		const afterRestore = await db.execute(
			"SELECT * FROM entities WHERE t_valid_until IS NULL AND archived_at IS NULL",
		);
		expect(afterRestore.rows).toHaveLength(3);

		// Verify by name
		const names = afterRestore.rows.map((r) => r.name).sort();
		expect(names).toEqual(["Entity Alpha", "Entity Beta", "Entity Gamma"]);
	});

	// ---------------------------------------------------------------
	// 4. Pre-rollback snapshot created before restore
	// ---------------------------------------------------------------

	it("pre-rollback snapshot created before restore", async () => {
		tmpDir = makeTmp();
		const repoHash = "snap-prerollback";
		db = openGraphDb(repoHash, tmpDir);

		// Insert entity and create initial snapshot
		await insertEntity(db, {
			type: "Concept",
			name: "Original Entity",
			content: "Original content",
			summary: "Original",
			created_by: "dev-1",
		});

		const initialSnapshot = await createSnapshot(db, repoHash, tmpDir);

		// Check 1 snapshot file exists
		const snapshotsBefore = listSnapshots(repoHash, tmpDir);
		expect(snapshotsBefore).toHaveLength(1);

		// Modify the graph state (add another entity so state differs)
		await insertEntity(db, {
			type: "Decision",
			name: "New Entity",
			content: "New content",
			summary: "New",
			created_by: "dev-1",
		});

		// Restore from the initial snapshot — this should create a pre-rollback snapshot first.
		// Since both snapshots happen on the same date, they will overwrite to the same filename.
		// But restoreSnapshot calls createSnapshot before restoring, so the file should exist.
		await restoreSnapshot(db, initialSnapshot, repoHash, tmpDir);

		// After restore, the pre-rollback snapshot was created.
		// Since it is the same calendar day, the file count may still be 1 (overwritten),
		// but verify the current snapshot file reflects the pre-rollback state
		// by checking the snapshot directory has at least 1 file.
		const snapshotsAfter = listSnapshots(repoHash, tmpDir);
		expect(snapshotsAfter.length).toBeGreaterThanOrEqual(1);

		// The key proof: read the most recent snapshot file — it should contain
		// the pre-rollback state (2 entities, not 1), because createSnapshot
		// was called before the restore wiped the graph.
		const latestSnapshotPath = snapshotsAfter[snapshotsAfter.length - 1]!;
		const latestData = JSON.parse(readFileSync(latestSnapshotPath, "utf-8")) as SnapshotData;
		expect(latestData.entities).toHaveLength(2);
	});

	// ---------------------------------------------------------------
	// 5. findNearestSnapshot returns correct file
	// ---------------------------------------------------------------

	it("findNearestSnapshot returns correct file", () => {
		tmpDir = makeTmp();
		const repoHash = "snap-nearest";
		const dir = join(tmpDir, "snapshots", repoHash);
		mkdirSync(dir, { recursive: true });

		// Create known snapshot files
		writeFileSync(join(dir, "2026-01-01.snapshot"), "{}", "utf-8");
		writeFileSync(join(dir, "2026-02-15.snapshot"), "{}", "utf-8");
		writeFileSync(join(dir, "2026-03-10.snapshot"), "{}", "utf-8");

		// Target: March 5, 2026 — nearest prior is Feb 15
		const march5 = Date.UTC(2026, 2, 5); // March is month 2 (0-indexed)
		const nearest = findNearestSnapshot(repoHash, march5, tmpDir);
		expect(nearest).not.toBeNull();
		expect(nearest).toContain("2026-02-15.snapshot");

		// Target: March 10, 2026 — exact match should return March 10
		const march10 = Date.UTC(2026, 2, 10);
		const exact = findNearestSnapshot(repoHash, march10, tmpDir);
		expect(exact).not.toBeNull();
		expect(exact).toContain("2026-03-10.snapshot");

		// Target: December 31, 2025 — before any snapshot
		const dec31 = Date.UTC(2025, 11, 31);
		const none = findNearestSnapshot(repoHash, dec31, tmpDir);
		expect(none).toBeNull();

		// Target: far in the future — should return the latest (March 10)
		const future = Date.UTC(2027, 0, 1);
		const latest = findNearestSnapshot(repoHash, future, tmpDir);
		expect(latest).not.toBeNull();
		expect(latest).toContain("2026-03-10.snapshot");
	});
});
