import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneConfirm, pruneDryRun } from "@/cli/commands/prune";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { archiveEntity, getEntity, insertEntity, invalidateEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("prune", () => {
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
	// dry-run lists archived entities
	// ---------------------------------------------------------------

	it("dry-run lists archived entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("prune-dry-archived", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Archived Concept",
			content: "This entity will be archived",
			summary: "Archived concept for prune test",
			importance: 0.3,
		});

		await archiveEntity(db, entity.id);

		const candidates = await pruneDryRun(db);
		expect(candidates).toHaveLength(1);
		expect(candidates[0].id).toBe(entity.id);
		expect(candidates[0].name).toBe("Archived Concept");
		expect(candidates[0].type).toBe("Concept");
		expect(candidates[0].importance).toBe(0.3);
		expect(typeof candidates[0].daysSinceAccess).toBe("number");
	});

	// ---------------------------------------------------------------
	// dry-run does NOT list invalidated entities
	// ---------------------------------------------------------------

	it("dry-run does NOT list invalidated entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("prune-dry-invalidated", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Invalidated Concept",
			content: "This entity will be invalidated",
			summary: "Invalidated concept for prune test",
		});

		await invalidateEntity(db, entity.id);

		const candidates = await pruneDryRun(db);
		expect(candidates).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// dry-run does NOT list active entities
	// ---------------------------------------------------------------

	it("dry-run does NOT list active entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("prune-dry-active", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Active Concept",
			content: "This entity stays active",
			summary: "Active concept for prune test",
		});

		const candidates = await pruneDryRun(db);
		expect(candidates).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// confirm deletes archived entities and edges
	// ---------------------------------------------------------------

	it("confirm deletes archived entities and edges", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("prune-confirm-delete", tmpDir);

		const entityA = await insertEntity(db, {
			type: "Concept",
			name: "Entity A",
			content: "Entity A will be archived and pruned",
			summary: "Entity A",
		});

		const entityB = await insertEntity(db, {
			type: "Concept",
			name: "Entity B",
			content: "Entity B stays active",
			summary: "Entity B",
		});

		await insertEdge(db, {
			from_id: entityA.id,
			to_id: entityB.id,
			type: "relates_to",
		});

		await archiveEntity(db, entityA.id);

		const deleted = await pruneConfirm(db);
		expect(deleted).toBe(1);

		// Entity A should no longer exist
		const entityAAfter = await getEntity(db, entityA.id);
		expect(entityAAfter).toBeUndefined();

		// Entity B should still exist
		const entityBAfter = await getEntity(db, entityB.id);
		expect(entityBAfter).toBeDefined();

		// Edge should be deleted
		const { rows: edges } = await db.execute("SELECT * FROM graph_edges WHERE from_id = ? OR to_id = ?", [
			entityA.id,
			entityA.id,
		]);
		expect(edges).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// confirm does NOT delete invalidated entities
	// ---------------------------------------------------------------

	it("confirm does NOT delete invalidated entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("prune-confirm-invalidated", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Invalidated Entity",
			content: "This entity is invalidated, not archived",
			summary: "Invalidated entity for prune confirm test",
		});

		await invalidateEntity(db, entity.id);

		const deleted = await pruneConfirm(db);
		expect(deleted).toBe(0);

		// Entity should still exist in DB
		const entityAfter = await getEntity(db, entity.id);
		expect(entityAfter).toBeDefined();
	});
});
