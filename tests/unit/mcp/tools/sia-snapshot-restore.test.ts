import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { createBranchSnapshot } from "@/graph/snapshots";
import { handleSiaSnapshotRestore } from "@/mcp/tools/sia-snapshot-restore";

describe("sia_snapshot_restore tool", () => {
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
	// Normal path — restores a previously stored snapshot
	// ---------------------------------------------------------------

	it("restores a stored branch snapshot and reports restored: true", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Pre-snapshot entity",
			content: "Exists at snapshot time",
			summary: "seed",
			created_by: "dev-1",
		});

		await createBranchSnapshot(db, "feature/restore", "commit-1");

		const result = await handleSiaSnapshotRestore(db, { branch_name: "feature/restore" });

		expect(result.restored).toBe(true);
		expect(result.branch_name).toBe("feature/restore");
	});

	// ---------------------------------------------------------------
	// Empty path — branch with no stored snapshot
	// ---------------------------------------------------------------

	it("reports restored: false when the branch has no stored snapshot", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		const result = await handleSiaSnapshotRestore(db, { branch_name: "never-snapshotted" });

		expect(result.restored).toBe(false);
		expect(result.branch_name).toBe("never-snapshotted");
	});

	// ---------------------------------------------------------------
	// Error path — invalid snapshot name
	// ---------------------------------------------------------------

	it("throws on an empty / whitespace-only branch name", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		await expect(handleSiaSnapshotRestore(db, { branch_name: "" })).rejects.toThrow(
			/Invalid snapshot name/,
		);
		await expect(handleSiaSnapshotRestore(db, { branch_name: "   " })).rejects.toThrow(
			/Invalid snapshot name/,
		);
	});

	// ---------------------------------------------------------------
	// next_steps: always suggests sia_doctor (verify after restore)
	// ---------------------------------------------------------------

	it("populates next_steps with sia_doctor to verify", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		const result = await handleSiaSnapshotRestore(db, { branch_name: "any" });
		expect(result.next_steps?.length).toBeGreaterThan(0);
		expect(result.next_steps?.map((s) => s.tool)).toContain("sia_doctor");
	});
});
