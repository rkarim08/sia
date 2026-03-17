import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveDecayedEntities } from "@/decay/archiver";
import type { SiaDb } from "@/graph/db-interface";
import { getActiveEntities, getEntity, insertEntity, invalidateEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { DEFAULT_CONFIG } from "@/shared/config";

// Helper
function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("archiver", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;
	const config = { ...DEFAULT_CONFIG };

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
	// archives entities below threshold with zero edges and 90-day inactivity
	// ---------------------------------------------------------------

	it("archives entities below threshold with zero edges and 90-day inactivity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("arch-basic", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Decayed Entity",
			content: "This entity has decayed below threshold",
			summary: "Decayed",
			importance: 0.01,
			base_importance: 0.01,
			edge_count: 0,
			last_accessed: Date.now() - 100 * 86400000,
		});

		const archived = await archiveDecayedEntities(db, config);
		expect(archived).toBe(1);

		const retrieved = await getEntity(db, entity.id);
		expect(retrieved).toBeDefined();
		expect(retrieved?.archived_at).not.toBeNull();
	});

	// ---------------------------------------------------------------
	// does NOT archive entity above threshold
	// ---------------------------------------------------------------

	it("does NOT archive entity above threshold", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("arch-above-threshold", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Important Entity",
			content: "This entity is above archive threshold",
			summary: "Important",
			importance: 0.5,
			base_importance: 0.5,
			edge_count: 0,
			last_accessed: Date.now() - 100 * 86400000,
		});

		const archived = await archiveDecayedEntities(db, config);
		expect(archived).toBe(0);
	});

	// ---------------------------------------------------------------
	// does NOT archive entity with edges
	// ---------------------------------------------------------------

	it("does NOT archive entity with edges", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("arch-has-edges", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Connected Entity",
			content: "This entity has edges and should not be archived",
			summary: "Connected",
			importance: 0.01,
			base_importance: 0.01,
			edge_count: 5,
			last_accessed: Date.now() - 100 * 86400000,
		});

		const archived = await archiveDecayedEntities(db, config);
		expect(archived).toBe(0);
	});

	// ---------------------------------------------------------------
	// does NOT archive recently accessed entity
	// ---------------------------------------------------------------

	it("does NOT archive recently accessed entity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("arch-recent", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Recent Entity",
			content: "This entity was recently accessed",
			summary: "Recent",
			importance: 0.01,
			base_importance: 0.01,
			edge_count: 0,
			last_accessed: Date.now() - 10 * 86400000,
		});

		const archived = await archiveDecayedEntities(db, config);
		expect(archived).toBe(0);
	});

	// ---------------------------------------------------------------
	// does NOT archive invalidated entities
	// ---------------------------------------------------------------

	it("does NOT archive invalidated entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("arch-invalidated", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Invalidated Entity",
			content: "This entity meets archive criteria but is invalidated",
			summary: "Invalidated",
			importance: 0.01,
			base_importance: 0.01,
			edge_count: 0,
			last_accessed: Date.now() - 100 * 86400000,
		});

		await invalidateEntity(db, entity.id);

		const archived = await archiveDecayedEntities(db, config);
		expect(archived).toBe(0);
	});

	// ---------------------------------------------------------------
	// archived entity is excluded from active entities
	// ---------------------------------------------------------------

	it("archived entity is excluded from active entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("arch-excluded", tmpDir);

		const keep = await insertEntity(db, {
			type: "Concept",
			name: "Keeper Entity",
			content: "This entity stays active",
			summary: "Keeper",
			importance: 0.5,
			base_importance: 0.5,
			edge_count: 0,
			last_accessed: Date.now(),
		});

		const _toArchive = await insertEntity(db, {
			type: "Concept",
			name: "Archivable Entity",
			content: "This entity will be archived",
			summary: "Archivable",
			importance: 0.01,
			base_importance: 0.01,
			edge_count: 0,
			last_accessed: Date.now() - 100 * 86400000,
		});

		await archiveDecayedEntities(db, config);

		const active = await getActiveEntities(db);
		expect(active).toHaveLength(1);
		expect(active[0]?.id).toBe(keep.id);
	});
});
