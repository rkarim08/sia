import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { createBranchSnapshot } from "@/graph/snapshots";
import { handleSiaSnapshotPrune } from "@/mcp/tools/sia-snapshot-prune";

describe("sia_snapshot_prune tool", () => {
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
	// Normal path — prunes existing branches
	// ---------------------------------------------------------------

	it("prunes snapshots for the named branches and returns the deleted count", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		await createBranchSnapshot(db, "feature/one", "hash-1");
		await createBranchSnapshot(db, "feature/two", "hash-2");
		await createBranchSnapshot(db, "feature/three", "hash-3");

		const result = await handleSiaSnapshotPrune(db, {
			branch_names: ["feature/one", "feature/two"],
		});

		expect(result).toEqual({
			pruned: 2,
			branch_names: ["feature/one", "feature/two"],
		});

		// feature/three is untouched.
		const { rows } = await db.execute("SELECT branch_name FROM branch_snapshots");
		expect(rows.map((r) => r.branch_name)).toEqual(["feature/three"]);
	});

	// ---------------------------------------------------------------
	// Empty path — no matching branches
	// ---------------------------------------------------------------

	it("returns pruned: 0 when none of the named branches exist", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		const result = await handleSiaSnapshotPrune(db, {
			branch_names: ["ghost-branch-a", "ghost-branch-b"],
		});

		expect(result).toEqual({
			pruned: 0,
			branch_names: ["ghost-branch-a", "ghost-branch-b"],
		});
	});

	// ---------------------------------------------------------------
	// Empty input list is an allowed no-op (matches graph layer)
	// ---------------------------------------------------------------

	it("returns pruned: 0 for an empty branch_names input", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		await createBranchSnapshot(db, "stays", "hash-s");

		const result = await handleSiaSnapshotPrune(db, { branch_names: [] });

		expect(result).toEqual({ pruned: 0, branch_names: [] });

		const { rows } = await db.execute("SELECT COUNT(*) AS cnt FROM branch_snapshots");
		expect(Number(rows[0].cnt)).toBe(1);
	});

	// ---------------------------------------------------------------
	// Error path — invalid snapshot name in the list
	// ---------------------------------------------------------------

	it("throws if any branch name is empty / whitespace-only", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		await createBranchSnapshot(db, "feature/live", "hash-live");

		await expect(
			handleSiaSnapshotPrune(db, { branch_names: ["feature/live", ""] }),
		).rejects.toThrow(/Invalid snapshot name/);

		// No rows were deleted — validation runs before the DB touch.
		const { rows } = await db.execute("SELECT COUNT(*) AS cnt FROM branch_snapshots");
		expect(Number(rows[0].cnt)).toBe(1);
	});
});
