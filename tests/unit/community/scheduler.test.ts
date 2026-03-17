import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectCommunities } from "@/community/leiden";
import { CommunityScheduler, shouldRunDetection } from "@/community/scheduler";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import type { SiaConfig } from "@/shared/config";
import { DEFAULT_CONFIG } from "@/shared/config";

async function seedEntities(db: SiaDb, count: number) {
	const ids: string[] = [];
	for (let i = 0; i < count; i++) {
		const entity = await insertEntity(db, {
			type: "Function",
			name: `entity-${i}`,
			content: `content-${i}`,
			summary: `summary-${i}`,
		});
		ids.push(entity.id);
	}
	for (let i = 0; i < ids.length - 1; i++) {
		await insertEdge(db, { from_id: ids[i], to_id: ids[i + 1], type: "calls", weight: 1 });
	}
}

describe("shouldRunDetection", () => {
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
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns false when graph is below minimum size", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("scheduler-repo", tmpDir);
		await seedEntities(db, 50);
		const config: SiaConfig = { ...DEFAULT_CONFIG };
		const result = await shouldRunDetection(db, config);
		expect(result).toBe(false);
	});

	it("fires when new entities exceed threshold and size is sufficient", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("scheduler-repo", tmpDir);
		await seedEntities(db, 120);
		const config: SiaConfig = { ...DEFAULT_CONFIG };
		const shouldRun = await shouldRunDetection(db, config);
		expect(shouldRun).toBe(true);

		await detectCommunities(db);
		const afterRun = await shouldRunDetection(db, config);
		expect(afterRun).toBe(false);
	}, 20000);
});

describe("CommunityScheduler", () => {
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
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("check returns false for small graph", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("scheduler-repo", tmpDir);
		await seedEntities(db, 10);
		const config: SiaConfig = { ...DEFAULT_CONFIG };
		const scheduler = new CommunityScheduler(db, config);
		const result = await scheduler.check();
		expect(result).toBe(false);
	});

	it("run completes without error", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("scheduler-repo", tmpDir);
		await seedEntities(db, 120);
		const config: SiaConfig = { ...DEFAULT_CONFIG };
		const scheduler = new CommunityScheduler(db, config);
		await expect(scheduler.run()).resolves.not.toThrow();
	}, 20000);
});
