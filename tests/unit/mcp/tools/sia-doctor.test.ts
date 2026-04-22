import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaDoctor } from "@/mcp/tools/sia-doctor";
import { checkRuntime } from "@/shared/diagnostics";

describe("sia_doctor tool", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	async function _insertTestNode(siaDb: SiaDb, opts: { id: string; name?: string }): Promise<void> {
		const now = Date.now();
		await siaDb.execute(
			`INSERT INTO graph_nodes (
				id, type, name, content, summary,
				tags, file_paths, trust_tier, confidence, base_confidence,
				importance, base_importance, access_count, edge_count,
				last_accessed, created_at,
				t_created, t_expired, t_valid_from, t_valid_until,
				visibility, created_by
			) VALUES (
				?, 'Concept', ?, 'test content', 'test summary',
				'[]', '[]', 3, 0.7, 0.7,
				0.5, 0.5, 0, 0,
				?, ?,
				?, NULL, NULL, NULL,
				'private', 'dev-1'
			)`,
			[opts.id, opts.name ?? "Test Node", now, now, now],
		);
	}

	async function insertOrphanEdge(
		siaDb: SiaDb,
		opts: { fromId: string; toId: string },
	): Promise<void> {
		const edgeId = randomUUID();
		const now = Date.now();
		// Use rawSqlite() to disable FK enforcement so we can insert an orphan edge
		const raw = siaDb.rawSqlite();
		if (raw) {
			raw.prepare("PRAGMA foreign_keys = OFF").run();
		}
		await siaDb.execute(
			`INSERT INTO graph_edges (
				id, from_id, to_id, type, weight, confidence, trust_tier,
				t_created, t_expired, t_valid_from, t_valid_until
			) VALUES (?, ?, ?, 'depends_on', 1.0, 0.7, 3, ?, NULL, NULL, NULL)`,
			[edgeId, opts.fromId, opts.toId, now],
		);
		if (raw) {
			raw.prepare("PRAGMA foreign_keys = ON").run();
		}
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

	// -----------------------------------------------------------------------
	// Test 1: checkRuntime("bash", "bash") → status "ok", version defined
	// -----------------------------------------------------------------------

	it('checkRuntime("bash", "bash") returns ok with a version string', async () => {
		const result = await checkRuntime("bash", "bash");

		expect(result.name).toBe("bash");
		expect(result.category).toBe("runtimes");
		expect(result.status).toBe("ok");
		expect(result.version).toBeDefined();
		expect(typeof result.version).toBe("string");
		expect(result.version?.length).toBeGreaterThan(0);
	});

	// -----------------------------------------------------------------------
	// Test 2: handleSiaDoctor(db, {}) runs all checks and returns healthy bool
	// -----------------------------------------------------------------------

	it("handleSiaDoctor with no input runs all checks and returns a healthy boolean", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		const result = await handleSiaDoctor(db, {});

		expect(Array.isArray(result.checks)).toBe(true);
		expect(result.checks.length).toBeGreaterThan(0);
		expect(typeof result.healthy).toBe("boolean");
		expect(Array.isArray(result.warnings)).toBe(true);

		// healthy must match checks
		const allOk = result.checks.every((c) => c.status === "ok");
		expect(result.healthy).toBe(allOk);

		// warnings must match non-ok checks
		const nonOkMessages = result.checks.filter((c) => c.status !== "ok").map((c) => c.message);
		expect(result.warnings).toEqual(nonOkMessages);
	});

	// -----------------------------------------------------------------------
	// Test 3: orphan edge → graph_integrity check returns status "warn"
	// -----------------------------------------------------------------------

	it("orphan_edges check returns warn when edges reference nonexistent nodes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		// Insert orphan edge — source/target don't exist in graph_nodes
		await insertOrphanEdge(db, {
			fromId: "nonexistent-node-a",
			toId: "nonexistent-node-b",
		});

		const result = await handleSiaDoctor(db, { checks: ["graph_integrity"] });

		const orphanCheck = result.checks.find((c) => c.name === "orphan_edges");
		expect(orphanCheck).toBeDefined();
		expect(orphanCheck?.status).toBe("warn");
	});

	// -----------------------------------------------------------------------
	// next_steps: sia_upgrade + /sia-setup on failure; sia_stats when healthy
	// -----------------------------------------------------------------------

	it("populates next_steps with upgrade/setup hints when any check fails", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		// Force a graph_integrity warn via orphan edge
		await insertOrphanEdge(db, { fromId: "x", toId: "y" });

		const result = await handleSiaDoctor(db, { checks: ["graph_integrity"] });
		expect(result.healthy).toBe(false);
		expect(result.next_steps?.length).toBeGreaterThan(0);
		const tools = result.next_steps?.map((s) => s.tool) ?? [];
		expect(tools).toContain("sia_upgrade");
		expect(tools).toContain("/sia-setup");
	});

	it("populates next_steps with sia_stats hint when healthy", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		// fts5 check is deterministic and should pass on a freshly opened DB
		const result = await handleSiaDoctor(db, { checks: ["fts5"] });
		if (result.healthy) {
			expect(result.next_steps?.length).toBeGreaterThan(0);
			expect(result.next_steps?.map((s) => s.tool)).toContain("sia_stats");
		} else {
			// If environment makes fts5 fail, we still test the other branch
			expect(result.next_steps?.map((s) => s.tool)).toContain("sia_upgrade");
		}
	});
});
