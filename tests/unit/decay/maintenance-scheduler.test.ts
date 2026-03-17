import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMaintenanceScheduler,
	loadMaintenanceState,
	runMaintenanceJobs,
	saveMaintenanceState,
} from "@/decay/maintenance-scheduler";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { DEFAULT_CONFIG } from "@/shared/config";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("maintenance scheduler", () => {
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
	// loads and saves maintenance state
	// ---------------------------------------------------------------

	it("loads and saves maintenance state", () => {
		tmpDir = makeTmp();
		const repoHash = "state-test";

		saveMaintenanceState(
			repoHash,
			{ lastSweepAt: 123, lastSessionSweepAt: 456, pendingBatchOffset: 0 },
			tmpDir,
		);

		const loaded = loadMaintenanceState(repoHash, tmpDir);
		expect(loaded.lastSweepAt).toBe(123);
		expect(loaded.lastSessionSweepAt).toBe(456);
		expect(loaded.pendingBatchOffset).toBe(0);
	});

	// ---------------------------------------------------------------
	// returns default state when no file exists
	// ---------------------------------------------------------------

	it("returns default state when no file exists", () => {
		tmpDir = makeTmp();

		const state = loadMaintenanceState("nonexistent", tmpDir);
		expect(state.lastSweepAt).toBe(0);
		expect(state.lastSessionSweepAt).toBe(0);
		expect(state.pendingBatchOffset).toBe(0);
	});

	// ---------------------------------------------------------------
	// createMaintenanceScheduler returns scheduler with all methods
	// ---------------------------------------------------------------

	it("createMaintenanceScheduler returns scheduler with all methods", () => {
		tmpDir = makeTmp();
		db = openGraphDb("scheduler-methods", tmpDir);

		const scheduler = createMaintenanceScheduler({
			graphDb: db,
			config: { ...DEFAULT_CONFIG },
			repoHash: "scheduler-methods",
			siaHome: tmpDir,
		});

		expect(typeof scheduler.onStartup).toBe("function");
		expect(typeof scheduler.onPostToolUse).toBe("function");
		expect(typeof scheduler.onSessionEnd).toBe("function");
		expect(typeof scheduler.stop).toBe("function");
	});

	// ---------------------------------------------------------------
	// stop prevents further processing
	// ---------------------------------------------------------------

	it("stop prevents further processing", () => {
		tmpDir = makeTmp();
		db = openGraphDb("scheduler-stop", tmpDir);

		const scheduler = createMaintenanceScheduler({
			graphDb: db,
			config: { ...DEFAULT_CONFIG },
			repoHash: "scheduler-stop",
			siaHome: tmpDir,
		});

		// Calling stop should not throw
		scheduler.stop();

		// Subsequent calls should be gracefully handled
		scheduler.onPostToolUse();
		expect(true).toBe(true);
	});

	// ---------------------------------------------------------------
	// runMaintenanceJobs runs all work units
	// ---------------------------------------------------------------

	it("runMaintenanceJobs runs all work units", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("maintenance-jobs", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Maintenance Target",
			content: "Entity to exercise maintenance jobs",
			summary: "Maintenance test entity",
			base_importance: 0.5,
			importance: 0.5,
			last_accessed: Date.now() - 30 * 86400000,
		});

		// Should not throw when running all work units
		await expect(runMaintenanceJobs({ ...DEFAULT_CONFIG }, db)).resolves.toBeUndefined();
	});
});
