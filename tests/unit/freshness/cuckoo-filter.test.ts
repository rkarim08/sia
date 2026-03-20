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

	it("remove unknown path returns false", () => {
		const filter = new CuckooFilter();
		expect(filter.remove("src/nonexistent.ts")).toBe(false);
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

	it("add returns true on success, dedup returns true without size change", () => {
		const filter = new CuckooFilter();
		const first = filter.add("src/x.ts");
		expect(first).toBe(true);
		expect(filter.size).toBe(1);

		const second = filter.add("src/x.ts");
		expect(second).toBe(true);
		expect(filter.size).toBe(1); // size unchanged
	});

	it("remove does not break contains for other items", () => {
		const filter = new CuckooFilter();
		filter.add("src/a.ts");
		filter.add("src/b.ts");
		filter.add("src/c.ts");
		filter.remove("src/b.ts");

		expect(filter.contains("src/a.ts")).toBe(true);
		expect(filter.contains("src/b.ts")).toBe(false);
		expect(filter.contains("src/c.ts")).toBe(true);
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

	// ---------------------------------------------------------------
	// Eviction, capacity, and statistical tests
	// ---------------------------------------------------------------

	it("handles eviction: all items found after filling to 90% capacity", () => {
		const filter = new CuckooFilter(256); // small: ~64 buckets * 4 slots
		const items: string[] = [];
		const target = Math.floor(256 * 0.9);

		for (let i = 0; i < target; i++) {
			const path = `src/eviction_test_file_${i}.ts`;
			items.push(path);
			expect(filter.add(path)).toBe(true);
		}

		for (const item of items) {
			expect(filter.contains(item)).toBe(true);
		}
		expect(filter.size).toBe(target);
	});

	it("eviction then remove: item in alternate bucket is removable", () => {
		const filter = new CuckooFilter(16); // tiny: 4 buckets
		const added: string[] = [];

		for (let i = 0; i < 14; i++) {
			const item = `evict_rm_${i}`;
			if (filter.add(item)) {
				added.push(item);
			}
		}

		// Must have added at least one item to remove
		expect(added.length).toBeGreaterThan(0);
		const last = added[added.length - 1];
		const sizeBefore = filter.size;
		expect(filter.remove(last)).toBe(true);
		expect(filter.contains(last)).toBe(false);
		expect(filter.size).toBe(sizeBefore - 1);
	});

	it("returns false when filter is full", () => {
		const filter = new CuckooFilter(16);
		let fullDetected = false;

		for (let i = 0; i < 100; i++) {
			if (!filter.add(`full_test_${i}`)) {
				fullDetected = true;
				break;
			}
		}

		expect(fullDetected).toBe(true);
	});

	it("throws on capacity exceeding ceiling", () => {
		expect(() => new CuckooFilter(300000)).toThrow(/too large/);
	});

	it("false positive rate < 0.1% for 50K items", () => {
		const filter = new CuckooFilter(65536);

		for (let i = 0; i < 50_000; i++) {
			filter.add(`src/path/file_${i}_${i * 31}.ts`);
		}
		// Allow for rare hash collisions causing near-50K (within 0.1% of 50K)
		expect(filter.size).toBeGreaterThanOrEqual(49_950);

		let falsePositives = 0;
		const testCount = 10_000;
		for (let i = 0; i < testCount; i++) {
			if (filter.contains(`src/other/notinserted_${i}_${i * 17}.ts`)) {
				falsePositives++;
			}
		}

		const rate = falsePositives / testCount;
		expect(rate).toBeLessThan(0.001); // < 0.1%
	});

	it("constructor accepts default capacity", () => {
		const filter = new CuckooFilter();
		expect(filter.size).toBe(0);
	});
});
