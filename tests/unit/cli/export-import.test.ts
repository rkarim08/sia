import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ExportData, exportGraph, exportToFile } from "@/cli/commands/export";
import { importGraph } from "@/cli/commands/import";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { archiveEntity, getEntity, insertEntity, invalidateEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("export and import", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;
	let db2: SiaDb | undefined;

	afterEach(async () => {
		if (db2) {
			await db2.close();
			db2 = undefined;
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
	// exports active entities and edges as JSON
	// ---------------------------------------------------------------

	it("exports active entities and edges as JSON", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("export-active", tmpDir);

		const e1 = await insertEntity(db, {
			type: "Concept",
			name: "Entity One",
			content: "First entity content",
			summary: "Entity one summary",
		});

		const e2 = await insertEntity(db, {
			type: "Decision",
			name: "Entity Two",
			content: "Second entity content",
			summary: "Entity two summary",
		});

		await insertEdge(db, {
			from_id: e1.id,
			to_id: e2.id,
			type: "relates_to",
		});

		const data = await exportGraph(db);

		expect(data.version).toBe(1);
		expect(data.entities).toHaveLength(2);
		expect(data.edges).toHaveLength(1);
		expect(typeof data.exportedAt).toBe("number");
	});

	// ---------------------------------------------------------------
	// excludes archived and invalidated entities from export
	// ---------------------------------------------------------------

	it("excludes archived and invalidated entities from export", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("export-exclude", tmpDir);

		// Active entity
		await insertEntity(db, {
			type: "Concept",
			name: "Active Entity",
			content: "This stays active",
			summary: "Active",
		});

		// Archived entity
		const archived = await insertEntity(db, {
			type: "Concept",
			name: "Archived Entity",
			content: "This will be archived",
			summary: "Archived",
		});
		await archiveEntity(db, archived.id);

		// Invalidated entity
		const invalidated = await insertEntity(db, {
			type: "Concept",
			name: "Invalidated Entity",
			content: "This will be invalidated",
			summary: "Invalidated",
		});
		await invalidateEntity(db, invalidated.id);

		const data = await exportGraph(db);

		expect(data.entities).toHaveLength(1);
		expect(data.entities[0]?.name).toBe("Active Entity");
	});

	// ---------------------------------------------------------------
	// import merge mode runs consolidation
	// ---------------------------------------------------------------

	it("import merge mode runs consolidation", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("export-merge-src", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Merge Entity",
			content: "Entity for merge import test",
			summary: "Merge entity",
		});

		const exportData = await exportGraph(db);

		// Create a new, separate db
		db2 = openGraphDb("import-merge-dst", tmpDir);

		const result = await importGraph(db2, exportData, "merge");
		expect(result.mode).toBe("merge");
		expect(result.entitiesImported).toBeGreaterThanOrEqual(1);

		// Verify entity exists in the new db
		const { rows } = await db2.execute(
			"SELECT * FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
		);
		expect(rows.length).toBeGreaterThanOrEqual(1);
		expect(rows.some((r) => r.name === "Merge Entity")).toBe(true);
	});

	// ---------------------------------------------------------------
	// import replace mode archives existing entities
	// ---------------------------------------------------------------

	it("import replace mode archives existing entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("import-replace", tmpDir);

		// Insert entity A (will be archived by replace import)
		const entityA = await insertEntity(db, {
			type: "Concept",
			name: "Entity A",
			content: "Original entity that should be archived",
			summary: "Entity A",
		});

		// Build export data with entity B
		const entityBId = randomUUID();
		const now = Date.now();
		const exportData: ExportData = {
			version: 1,
			exportedAt: now,
			entities: [
				{
					id: entityBId,
					type: "Decision",
					name: "Entity B",
					content: "Imported entity B",
					summary: "Entity B",
				},
			],
			edges: [],
			communities: [],
			crossRepoEdges: [],
		};

		await importGraph(db, exportData, "replace");

		// Entity A should be archived (archived_at IS NOT NULL)
		const aAfter = await getEntity(db, entityA.id);
		expect(aAfter).toBeDefined();
		expect(aAfter?.archived_at).not.toBeNull();

		// Entity B should be in the graph
		const bAfter = await getEntity(db, entityBId);
		expect(bAfter).toBeDefined();
		expect(bAfter?.name).toBe("Entity B");
	});

	// ---------------------------------------------------------------
	// round-trip export then import produces equivalent graph
	// ---------------------------------------------------------------

	it("round-trip export then import produces equivalent graph", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("roundtrip-src", tmpDir);

		const e1 = await insertEntity(db, {
			type: "Concept",
			name: "Roundtrip Alpha",
			content: "Alpha content for roundtrip",
			summary: "Alpha",
		});

		const e2 = await insertEntity(db, {
			type: "Decision",
			name: "Roundtrip Beta",
			content: "Beta content for roundtrip",
			summary: "Beta",
		});

		await insertEdge(db, {
			from_id: e1.id,
			to_id: e2.id,
			type: "depends_on",
		});

		// Export from original db
		const exportData = await exportGraph(db);

		// Create new empty db and import with replace (preserves IDs)
		db2 = openGraphDb("roundtrip-dst", tmpDir);
		await importGraph(db2, exportData, "replace");

		// Export from the new db
		const reExported = await exportGraph(db2);

		// Entity count should match
		expect(reExported.entities.length).toBe(exportData.entities.length);
		// Edge count should match
		expect(reExported.edges.length).toBe(exportData.edges.length);
	});

	// ---------------------------------------------------------------
	// import rejects unknown schema version
	// ---------------------------------------------------------------

	it("import rejects unknown schema version", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("import-bad-version", tmpDir);

		const badData = {
			version: 99,
			exportedAt: Date.now(),
			entities: [],
			edges: [],
			communities: [],
			crossRepoEdges: [],
		} as unknown as ExportData;

		await expect(importGraph(db, badData, "merge")).rejects.toThrow(/Unsupported export version/);
	});

	// ---------------------------------------------------------------
	// exportToFile writes valid JSON to disk
	// ---------------------------------------------------------------

	it("exportToFile writes valid JSON to disk", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("export-to-file", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "File Export Entity",
			content: "Entity for file export test",
			summary: "File export entity",
		});

		const outputPath = join(tmpDir, "export-output", "graph.json");
		const result = await exportToFile(db, outputPath);

		expect(result).toBe(outputPath);
		expect(existsSync(outputPath)).toBe(true);

		// Parse the file and verify it is valid ExportData
		const raw = readFileSync(outputPath, "utf-8");
		const data = JSON.parse(raw) as ExportData;

		expect(data.version).toBe(1);
		expect(typeof data.exportedAt).toBe("number");
		expect(data.entities).toHaveLength(1);
		expect(data.entities[0]?.name).toBe("File Export Entity");
		expect(Array.isArray(data.edges)).toBe(true);
	});
});
