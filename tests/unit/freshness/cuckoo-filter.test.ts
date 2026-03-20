import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CuckooFilter } from "@/freshness/cuckoo-filter";
import { addDependency } from "@/freshness/inverted-index";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

/** Insert a minimal entity row so FK constraints are satisfied. */
async function seedEntity(db: SiaDb, id: string): Promise<void> {
	const now = Date.now();
	await db.execute(
		`INSERT INTO graph_nodes (
			id, type, name, content, summary, tags, file_paths,
			trust_tier, confidence, base_confidence,
			importance, base_importance, access_count, edge_count,
			last_accessed, created_at, t_created,
			visibility, created_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			"Concept",
			id,
			"test",
			"test",
			"[]",
			"[]",
			3,
			0.7,
			0.7,
			0.5,
			0.5,
			0,
			0,
			now,
			now,
			now,
			"private",
			"dev-1",
		],
	);
}

describe("CuckooFilter", () => {
	// ---------------------------------------------------------------
	// In-memory filter tests (no DB needed)
	// ---------------------------------------------------------------

	it("add + contains returns true", () => {
		const filter = new CuckooFilter();
		filter.add("src/foo.ts");
		expect(filter.contains("src/foo.ts")).toBe(true);
	});

	it("contains returns false for unknown path", () => {
		const filter = new CuckooFilter();
		filter.add("src/foo.ts");
		expect(filter.contains("src/bar.ts")).toBe(false);
	});

	it("remove + contains returns false", () => {
		const filter = new CuckooFilter();
		filter.add("src/foo.ts");
		filter.remove("src/foo.ts");
		expect(filter.contains("src/foo.ts")).toBe(false);
	});

	it("clear empties the filter", () => {
		const filter = new CuckooFilter();
		filter.add("src/a.ts");
		filter.add("src/b.ts");
		filter.add("src/c.ts");
		expect(filter.size).toBe(3);

		filter.clear();
		expect(filter.size).toBe(0);
		expect(filter.contains("src/a.ts")).toBe(false);
	});

	it("size reflects distinct entries", () => {
		const filter = new CuckooFilter();
		filter.add("src/a.ts");
		filter.add("src/b.ts");
		filter.add("src/a.ts"); // duplicate
		expect(filter.size).toBe(2);
	});

	// ---------------------------------------------------------------
	// fromDatabase builds from source_deps table
	// ---------------------------------------------------------------

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

	it("fromDatabase builds from source_deps table", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("cuckoo-from-db", tmpDir);

		// Seed entities for FK constraints
		await seedEntity(db, "n1");
		await seedEntity(db, "n2");
		await seedEntity(db, "n3");

		// Seed source_deps with some entries
		await addDependency(db, {
			source_path: "src/alpha.ts",
			node_id: "n1",
			dep_type: "defines",
			source_mtime: 100,
		});
		await addDependency(db, {
			source_path: "src/beta.ts",
			node_id: "n2",
			dep_type: "defines",
			source_mtime: 200,
		});
		await addDependency(db, {
			source_path: "src/alpha.ts",
			node_id: "n3",
			dep_type: "references",
			source_mtime: 300,
		});

		const filter = await CuckooFilter.fromDatabase(db);

		expect(filter.size).toBe(2); // alpha + beta (distinct)
		expect(filter.contains("src/alpha.ts")).toBe(true);
		expect(filter.contains("src/beta.ts")).toBe(true);
		expect(filter.contains("src/gamma.ts")).toBe(false);
	});

	it("fromDatabase returns empty filter for empty table", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("cuckoo-empty", tmpDir);

		const filter = await CuckooFilter.fromDatabase(db);
		expect(filter.size).toBe(0);
	});
});
