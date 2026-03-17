import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaAtTime, parseAsOf } from "@/mcp/tools/sia-at-time";

describe("sia_at_time tool", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	/** Insert a test entity directly via db.execute, returning its id. */
	async function insertTestEntity(
		siaDb: SiaDb,
		overrides: Partial<{
			id: string;
			type: string;
			name: string;
			content: string;
			summary: string;
			tags: string;
			t_valid_from: number | null;
			t_valid_until: number | null;
			t_expired: number | null;
			archived_at: number | null;
		}> = {},
	): Promise<string> {
		const now = Date.now();
		const id = overrides.id ?? randomUUID();
		await siaDb.execute(
			`INSERT INTO entities (
				id, type, name, content, summary,
				tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance,
				access_count, edge_count,
				last_accessed, created_at,
				t_created, t_expired, t_valid_from, t_valid_until,
				visibility, created_by,
				archived_at
			) VALUES (
				?, ?, ?, ?, ?,
				?, '[]',
				3, 0.7, 0.7,
				0.5, 0.5,
				0, 0,
				?, ?,
				?, ?, ?, ?,
				'private', 'dev-1',
				?
			)`,
			[
				id,
				overrides.type ?? "Concept",
				overrides.name ?? "Test Entity",
				overrides.content ?? "test content",
				overrides.summary ?? "test summary",
				overrides.tags ?? "[]",
				now,
				now,
				now,
				overrides.t_expired ?? null,
				overrides.t_valid_from ?? null,
				overrides.t_valid_until ?? null,
				overrides.archived_at ?? null,
			],
		);
		return id;
	}

	/** Insert a test edge directly via db.execute, returning its id. */
	async function insertTestEdge(
		siaDb: SiaDb,
		fromId: string,
		toId: string,
		overrides: Partial<{
			t_valid_from: number | null;
			t_valid_until: number | null;
		}> = {},
	): Promise<string> {
		const id = randomUUID();
		const now = Date.now();
		await siaDb.execute(
			`INSERT INTO edges (
				id, from_id, to_id, type, weight, confidence, trust_tier,
				t_created, t_expired, t_valid_from, t_valid_until
			) VALUES (?, ?, ?, 'relates_to', 1.0, 0.7, 3, ?, NULL, ?, ?)`,
			[id, fromId, toId, now, overrides.t_valid_from ?? null, overrides.t_valid_until ?? null],
		);
		return id;
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
	// Excludes entities invalidated before as_of
	// ---------------------------------------------------------------

	it("excludes entities invalidated before as_of", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("at-time-exclude", tmpDir);

		const asOf = 5000;

		// Entity invalidated at t=3000 (before as_of) — should NOT appear in active
		await insertTestEntity(db, {
			name: "Invalidated Before",
			t_valid_from: 1000,
			t_valid_until: 3000,
		});

		// Entity still active at as_of
		await insertTestEntity(db, {
			name: "Active At AsOf",
			t_valid_from: 2000,
			t_valid_until: null,
		});

		const result = await handleSiaAtTime(db, { as_of: new Date(asOf).toISOString() });
		expect(result.entities).toHaveLength(1);
		expect(result.entities[0].name).toBe("Active At AsOf");
	});

	// ---------------------------------------------------------------
	// Includes entities active at as_of
	// ---------------------------------------------------------------

	it("includes entities active at as_of", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("at-time-active", tmpDir);

		const asOf = 5000;

		// t_valid_from=null means "always been valid" — should be included
		await insertTestEntity(db, {
			name: "No Valid From",
			t_valid_from: null,
			t_valid_until: null,
		});

		// t_valid_from <= as_of AND t_valid_until > as_of — active
		await insertTestEntity(db, {
			name: "Valid Range Active",
			t_valid_from: 3000,
			t_valid_until: 7000,
		});

		// t_valid_from > as_of — not yet valid
		await insertTestEntity(db, {
			name: "Not Yet Valid",
			t_valid_from: 6000,
			t_valid_until: null,
		});

		const result = await handleSiaAtTime(db, { as_of: new Date(asOf).toISOString() });
		expect(result.entities).toHaveLength(2);
		const names = result.entities.map((e) => e.name).sort();
		expect(names).toEqual(["No Valid From", "Valid Range Active"]);
	});

	// ---------------------------------------------------------------
	// Relative timestamp "30 days ago" parses correctly
	// ---------------------------------------------------------------

	it('relative timestamp "30 days ago" parses correctly', () => {
		const before = Date.now();
		const parsed = parseAsOf("30 days ago");
		const after = Date.now();

		const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
		expect(parsed).toBeGreaterThanOrEqual(before - thirtyDaysMs);
		expect(parsed).toBeLessThanOrEqual(after - thirtyDaysMs);
	});

	// ---------------------------------------------------------------
	// ISO 8601 timestamp works
	// ---------------------------------------------------------------

	it("ISO 8601 timestamp works", () => {
		const iso = "2024-06-15T12:00:00.000Z";
		const parsed = parseAsOf(iso);
		expect(parsed).toBe(new Date(iso).getTime());
	});

	// ---------------------------------------------------------------
	// invalidated_entities populated correctly (sorted DESC)
	// ---------------------------------------------------------------

	it("invalidated_entities populated correctly sorted by t_valid_until DESC", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("at-time-invalidated", tmpDir);

		const asOf = 10000;

		// 3 entities invalidated before as_of at different times
		await insertTestEntity(db, {
			name: "Inv A",
			t_valid_from: 1000,
			t_valid_until: 4000,
		});
		await insertTestEntity(db, {
			name: "Inv C",
			t_valid_from: 1000,
			t_valid_until: 8000,
		});
		await insertTestEntity(db, {
			name: "Inv B",
			t_valid_from: 1000,
			t_valid_until: 6000,
		});

		// 1 entity invalidated AFTER as_of — should NOT appear in invalidated
		await insertTestEntity(db, {
			name: "Inv After",
			t_valid_from: 1000,
			t_valid_until: 12000,
		});

		const result = await handleSiaAtTime(db, { as_of: new Date(asOf).toISOString() });

		expect(result.invalidated_entities).toHaveLength(3);
		// Sorted DESC by t_valid_until: 8000, 6000, 4000
		expect(result.invalidated_entities[0].name).toBe("Inv C");
		expect(result.invalidated_entities[1].name).toBe("Inv B");
		expect(result.invalidated_entities[2].name).toBe("Inv A");
	});

	// ---------------------------------------------------------------
	// invalidated_count reflects total before limit truncation
	// ---------------------------------------------------------------

	it("invalidated_count reflects total before limit truncation", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("at-time-inv-count", tmpDir);

		const asOf = 100000;

		// Insert 5 invalidated entities
		for (let i = 0; i < 5; i++) {
			await insertTestEntity(db, {
				name: `Inv ${i}`,
				t_valid_from: 1000,
				t_valid_until: 10000 + i * 1000,
			});
		}

		const result = await handleSiaAtTime(db, {
			as_of: new Date(asOf).toISOString(),
			limit: 3,
		});

		// invalidated_count = total invalidated (5), but array is capped at limit (3)
		expect(result.invalidated_count).toBe(5);
		expect(result.invalidated_entities).toHaveLength(3);
	});

	// ---------------------------------------------------------------
	// Bi-temporal filter applied to both entities and edges
	// ---------------------------------------------------------------

	it("bi-temporal filter applied to both entities and edges", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("at-time-bitemporal", tmpDir);

		const asOf = 5000;

		// Active entity at as_of
		const activeId = await insertTestEntity(db, {
			name: "Active Entity",
			t_valid_from: 1000,
			t_valid_until: null,
		});

		// Another active entity for edge endpoints
		const otherId = await insertTestEntity(db, {
			name: "Other Entity",
			t_valid_from: 1000,
			t_valid_until: null,
		});

		// Edge active at as_of (t_valid_from=2000, no t_valid_until)
		await insertTestEdge(db, activeId, otherId, {
			t_valid_from: 2000,
			t_valid_until: null,
		});

		// Edge invalidated before as_of
		await insertTestEdge(db, activeId, otherId, {
			t_valid_from: 1000,
			t_valid_until: 3000,
		});

		// Edge not yet valid at as_of
		await insertTestEdge(db, activeId, otherId, {
			t_valid_from: 6000,
			t_valid_until: null,
		});

		const result = await handleSiaAtTime(db, { as_of: new Date(asOf).toISOString() });

		expect(result.entities).toHaveLength(2);
		expect(result.edges).toHaveLength(1);
		expect(result.edge_count).toBe(1);
	});
});
