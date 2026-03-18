import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getOutgoingNeighbors, isFirewallNode } from "@/freshness/firewall";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

/** Insert a minimal entity row. */
async function seedEntity(db: SiaDb, id: string, edgeCount = 0): Promise<void> {
	const now = Date.now();
	await db.execute(
		`INSERT INTO entities (
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
			edgeCount,
			now,
			now,
			now,
			"private",
			"dev-1",
		],
	);
}

/** Insert an active edge between two entities. */
async function seedEdge(
	db: SiaDb,
	fromId: string,
	toId: string,
	type = "depends_on",
): Promise<void> {
	const now = Date.now();
	await db.execute(
		`INSERT INTO edges (
			id, from_id, to_id, type, weight, confidence, trust_tier,
			t_created
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[randomUUID(), fromId, toId, type, 1.0, 0.7, 3, now],
	);
}

/** Insert an invalidated (expired) edge. */
async function seedExpiredEdge(db: SiaDb, fromId: string, toId: string): Promise<void> {
	const now = Date.now();
	await db.execute(
		`INSERT INTO edges (
			id, from_id, to_id, type, weight, confidence, trust_tier,
			t_created, t_valid_until, t_expired
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[randomUUID(), fromId, toId, "depends_on", 1.0, 0.7, 3, now, now, now],
	);
}

describe("firewall", () => {
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

	// ---------------------------------------------------------------
	// isFirewallNode
	// ---------------------------------------------------------------
	describe("isFirewallNode", () => {
		it("returns true for nodes with edge_count > 50", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fw-high", tmpDir);

			await seedEntity(db, "hub-node", 60);

			const result = await isFirewallNode(db, "hub-node");
			expect(result).toBe(true);
		});

		it("returns false for nodes with edge_count <= 50", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fw-low", tmpDir);

			await seedEntity(db, "normal-node", 10);

			const result = await isFirewallNode(db, "normal-node");
			expect(result).toBe(false);
		});

		it("returns false for exactly threshold edges", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fw-exact", tmpDir);

			await seedEntity(db, "border-node", 50);

			const result = await isFirewallNode(db, "border-node");
			expect(result).toBe(false);
		});

		it("respects custom threshold", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fw-custom", tmpDir);

			await seedEntity(db, "node-20", 20);

			expect(await isFirewallNode(db, "node-20", 10)).toBe(true);
			expect(await isFirewallNode(db, "node-20", 25)).toBe(false);
		});

		it("returns false for unknown nodes", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fw-unknown", tmpDir);

			const result = await isFirewallNode(db, "nonexistent");
			expect(result).toBe(false);
		});
	});

	// ---------------------------------------------------------------
	// getOutgoingNeighbors
	// ---------------------------------------------------------------
	describe("getOutgoingNeighbors", () => {
		it("returns only active edges", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fw-neighbors-active", tmpDir);

			await seedEntity(db, "src", 2);
			await seedEntity(db, "active-target", 1);
			await seedEntity(db, "expired-target", 1);

			await seedEdge(db, "src", "active-target");
			await seedExpiredEdge(db, "src", "expired-target");

			const neighbors = await getOutgoingNeighbors(db, "src");
			expect(neighbors).toHaveLength(1);
			expect(neighbors[0].nodeId).toBe("active-target");
		});

		it("returns empty array for nodes with no outgoing edges", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fw-neighbors-none", tmpDir);

			await seedEntity(db, "isolated", 0);

			const neighbors = await getOutgoingNeighbors(db, "isolated");
			expect(neighbors).toHaveLength(0);
		});

		it("includes edge_count from the target entity", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fw-neighbors-count", tmpDir);

			// Seed with 74 because the trigger will +1 when the edge is inserted
			await seedEntity(db, "src", 1);
			await seedEntity(db, "target-hub", 74);

			await seedEdge(db, "src", "target-hub");

			const neighbors = await getOutgoingNeighbors(db, "src");
			expect(neighbors).toHaveLength(1);
			// 74 (seeded) + 1 (trigger on edge insert) = 75
			expect(neighbors[0].edgeCount).toBe(75);
		});

		it("follows both from_id and to_id for outgoing neighbors", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fw-neighbors-bidir", tmpDir);

			await seedEntity(db, "center", 2);
			await seedEntity(db, "dep-a", 5);
			await seedEntity(db, "dep-b", 3);

			// center -> dep-a (from_id = center)
			await seedEdge(db, "center", "dep-a");
			// dep-b -> center (to_id = center)
			await seedEdge(db, "dep-b", "center");

			const neighbors = await getOutgoingNeighbors(db, "center");
			const ids = neighbors.map((n) => n.nodeId).sort();
			expect(ids).toEqual(["dep-a", "dep-b"]);
		});
	});
});
