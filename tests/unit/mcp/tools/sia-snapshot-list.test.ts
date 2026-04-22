import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import * as snapshotsModule from "@/graph/snapshots";
import { createBranchSnapshot } from "@/graph/snapshots";
import { handleSiaSnapshotList } from "@/mcp/tools/sia-snapshot-list";

describe("sia_snapshot_list tool", () => {
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
		vi.restoreAllMocks();
	});

	// ---------------------------------------------------------------
	// Empty path
	// ---------------------------------------------------------------

	it("returns an empty snapshots array when no branch snapshots exist", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		const result = await handleSiaSnapshotList(db);

		expect(result).toEqual({ snapshots: [] });
		expect(result.error).toBeUndefined();
	});

	// ---------------------------------------------------------------
	// Normal path
	// ---------------------------------------------------------------

	it("returns summary rows for each stored branch snapshot", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		await createBranchSnapshot(db, "feature/alpha", "abc123");
		await createBranchSnapshot(db, "feature/beta", "def456");

		const result = await handleSiaSnapshotList(db);

		expect(result.error).toBeUndefined();
		expect(result.snapshots).toHaveLength(2);
		const names = result.snapshots.map((r) => r.branch_name).sort();
		expect(names).toEqual(["feature/alpha", "feature/beta"]);

		// Every row exposes the documented summary columns and nothing else.
		for (const row of result.snapshots) {
			expect(row).toEqual({
				branch_name: expect.any(String),
				commit_hash: expect.any(String),
				node_count: expect.any(Number),
				edge_count: expect.any(Number),
				updated_at: expect.any(Number),
			});
		}
	});

	// ---------------------------------------------------------------
	// snapshot_data is not leaked to MCP callers
	// ---------------------------------------------------------------

	it("does not expose the snapshot_data blob in the MCP response", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		await createBranchSnapshot(db, "main", "hash-main");

		const result = await handleSiaSnapshotList(db);

		expect(result.snapshots).toHaveLength(1);
		expect(Object.keys(result.snapshots[0])).not.toContain("snapshot_data");
		expect(Object.keys(result.snapshots[0])).not.toContain("id");
		expect(Object.keys(result.snapshots[0])).not.toContain("created_at");
	});

	// ---------------------------------------------------------------
	// Error path — listBranchSnapshots throws
	// ---------------------------------------------------------------

	it("returns the documented error shape when the underlying query throws", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		const spy = vi.spyOn(snapshotsModule, "listBranchSnapshots").mockImplementation(async () => {
			throw new Error("boom from graph layer");
		});

		// Should not propagate — handler swallows and returns { snapshots: [], error }.
		const result = await handleSiaSnapshotList(db);

		expect(spy).toHaveBeenCalledOnce();
		expect(result.snapshots).toEqual([]);
		expect(result.error).toMatch(/Snapshot list query failed/);
		expect(result.error).toMatch(/boom from graph layer/);
	});
});
