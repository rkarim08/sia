import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaStats } from "@/mcp/tools/sia-stats";

describe("sia_stats tool", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	/** Insert a test entity directly via db.execute. */
	async function insertTestNode(
		siaDb: SiaDb,
		overrides: Partial<{
			id: string;
			type: string;
			name: string;
		}> = {},
	): Promise<string> {
		const now = Date.now();
		const id = overrides.id ?? randomUUID();
		await siaDb.execute(
			`INSERT INTO graph_nodes (
				id, type, name, content, summary,
				package_path, tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance,
				access_count, edge_count,
				last_accessed, created_at,
				t_created, t_expired, t_valid_from, t_valid_until,
				visibility, created_by,
				conflict_group_id, extraction_method,
				archived_at
			) VALUES (
				?, ?, ?, ?, ?,
				?, ?, ?,
				?, ?, 0.7,
				?, 0.5,
				0, 0,
				?, ?,
				?, NULL, ?, ?,
				'private', 'dev-1',
				?, ?,
				?
			)`,
			[
				id,
				overrides.type ?? "Concept",
				overrides.name ?? "Test Entity",
				"test content",
				"test summary",
				null,
				"[]",
				'["src/foo.ts"]',
				3,
				0.7,
				0.5,
				now,
				now,
				now,
				null,
				null,
				null,
				null,
				null,
			],
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
	// Returns empty records for an empty graph
	// ---------------------------------------------------------------

	it("returns empty node and edge records for an empty graph", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		const result = await handleSiaStats(db, {});

		expect(result.nodes).toEqual({});
		expect(result.edges).toEqual({});
		expect(result.session).toBeUndefined();
	});

	// ---------------------------------------------------------------
	// Counts nodes by type
	// ---------------------------------------------------------------

	it("counts nodes by type correctly", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		await insertTestNode(db, { type: "Decision", name: "Decision 1" });
		await insertTestNode(db, { type: "Decision", name: "Decision 2" });
		await insertTestNode(db, { type: "Convention", name: "Convention 1" });

		const result = await handleSiaStats(db, {});

		expect(result.nodes).toEqual({
			Decision: 2,
			Convention: 1,
		});
		expect(result.edges).toEqual({});
		expect(result.session).toBeUndefined();
	});
});
