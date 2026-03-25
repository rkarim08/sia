import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaImpact } from "@/mcp/tools/sia-impact";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-impact-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("sia_impact tool", () => {
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
	// Isolated node -> only itself
	// ---------------------------------------------------------------

	it("returns only the entity itself for an isolated node", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("impact-isolated", tmpDir);

		const isolated = await insertEntity(db, {
			type: "CodeEntity",
			name: "IsolatedFunc",
			content: "function isolated() {}",
			summary: "An isolated function",
			file_paths: JSON.stringify(["src/isolated.ts"]),
		});

		const result = await handleSiaImpact(db, { entity_id: isolated.id });

		expect(result.entity.id).toBe(isolated.id);
		expect(result.entity.name).toBe("IsolatedFunc");
		expect(result.impact.length).toBe(0); // No neighbors
	});

	// ---------------------------------------------------------------
	// Node with 3 edges -> all direct neighbors at depth 1
	// ---------------------------------------------------------------

	it("finds all direct neighbors at depth 1", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("impact-neighbors", tmpDir);

		const center = await insertEntity(db, {
			type: "CodeEntity",
			name: "CenterFunc",
			content: "center",
			summary: "Center function",
			file_paths: JSON.stringify(["src/center.ts"]),
		});

		const n1 = await insertEntity(db, {
			type: "CodeEntity",
			name: "Neighbor1",
			content: "n1",
			summary: "Neighbor 1",
			file_paths: JSON.stringify(["src/n1.ts"]),
		});
		const n2 = await insertEntity(db, {
			type: "CodeEntity",
			name: "Neighbor2",
			content: "n2",
			summary: "Neighbor 2",
			file_paths: JSON.stringify(["src/n2.ts"]),
		});
		const n3 = await insertEntity(db, {
			type: "CodeEntity",
			name: "Neighbor3",
			content: "n3",
			summary: "Neighbor 3",
			file_paths: JSON.stringify(["src/n3.ts"]),
		});

		await insertEdge(db, { from_id: center.id, to_id: n1.id, type: "calls" });
		await insertEdge(db, { from_id: center.id, to_id: n2.id, type: "imports" });
		await insertEdge(db, { from_id: n3.id, to_id: center.id, type: "calls" });

		const result = await handleSiaImpact(db, { entity_id: center.id });

		expect(result.impact.length).toBeGreaterThanOrEqual(1);
		const depth1 = result.impact.find((i) => i.depth === 1);
		expect(depth1).toBeDefined();
		expect(depth1!.entities.length).toBe(3);

		const neighborIds = depth1!.entities.map((e) => e.id).sort();
		expect(neighborIds).toContain(n1.id);
		expect(neighborIds).toContain(n2.id);
		expect(neighborIds).toContain(n3.id);
	});

	// ---------------------------------------------------------------
	// Depth labels: d=1 "WILL BREAK", d=2 "LIKELY AFFECTED", d=3 "MAY NEED TESTING"
	// ---------------------------------------------------------------

	it("assigns correct labels based on depth", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("impact-labels", tmpDir);

		const root = await insertEntity(db, {
			type: "CodeEntity",
			name: "Root",
			content: "root",
			summary: "Root",
			file_paths: JSON.stringify(["src/root.ts"]),
		});
		const d1 = await insertEntity(db, {
			type: "CodeEntity",
			name: "Depth1",
			content: "depth1",
			summary: "Depth 1",
			file_paths: JSON.stringify(["src/d1.ts"]),
		});
		const d2 = await insertEntity(db, {
			type: "CodeEntity",
			name: "Depth2",
			content: "depth2",
			summary: "Depth 2",
			file_paths: JSON.stringify(["src/d2.ts"]),
		});
		const d3 = await insertEntity(db, {
			type: "CodeEntity",
			name: "Depth3",
			content: "depth3",
			summary: "Depth 3",
			file_paths: JSON.stringify(["src/d3.ts"]),
		});

		await insertEdge(db, { from_id: root.id, to_id: d1.id, type: "calls" });
		await insertEdge(db, { from_id: d1.id, to_id: d2.id, type: "calls" });
		await insertEdge(db, { from_id: d2.id, to_id: d3.id, type: "calls" });

		const result = await handleSiaImpact(db, { entity_id: root.id, max_depth: 3 });

		const depthMap = new Map(result.impact.map((i) => [i.depth, i]));

		expect(depthMap.get(1)?.label).toBe("WILL BREAK");
		expect(depthMap.get(2)?.label).toBe("LIKELY AFFECTED");
		expect(depthMap.get(3)?.label).toBe("MAY NEED TESTING");
	});

	// ---------------------------------------------------------------
	// Process participation
	// ---------------------------------------------------------------

	it("reports affected processes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("impact-processes", tmpDir);

		const a = await insertEntity(db, {
			type: "CodeEntity",
			name: "FuncA",
			content: "a",
			summary: "A",
			file_paths: JSON.stringify(["src/a.ts"]),
		});
		const b = await insertEntity(db, {
			type: "CodeEntity",
			name: "FuncB",
			content: "b",
			summary: "B",
			file_paths: JSON.stringify(["src/b.ts"]),
		});

		await insertEdge(db, { from_id: a.id, to_id: b.id, type: "calls" });

		// Insert a process that includes node A
		const processId = randomUUID();
		const now = Date.now();
		await db.execute(
			`INSERT INTO processes (id, name, entry_node_id, terminal_node_id, step_count, scope, entry_score, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[processId, "FuncA -> FuncB", a.id, b.id, 2, "intra", 0.8, now, now],
		);
		await db.execute(
			"INSERT INTO process_steps (process_id, node_id, step_order, confidence) VALUES (?, ?, ?, ?)",
			[processId, a.id, 0, 1.0],
		);
		await db.execute(
			"INSERT INTO process_steps (process_id, node_id, step_order, confidence) VALUES (?, ?, ?, ?)",
			[processId, b.id, 1, 0.9],
		);

		const result = await handleSiaImpact(db, { entity_id: a.id });

		expect(result.processes_affected.length).toBe(1);
		expect(result.processes_affected[0].name).toBe("FuncA -> FuncB");
		expect(result.processes_affected[0].step_count).toBe(2);
	});
});
