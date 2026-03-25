import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { extractSubgraph } from "@/visualization/subgraph-extract";

describe("subgraph extraction", () => {
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
	// Default mode: extracts top nodes by importance
	// ---------------------------------------------------------------

	it("extracts top nodes by importance in default mode", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vis-default", tmpDir);

		// Insert 5 entities with varying importance
		for (let i = 0; i < 5; i++) {
			await insertEntity(db, {
				type: "Concept",
				name: `Entity ${i}`,
				content: `Content ${i}`,
				summary: `Summary ${i}`,
				importance: (i + 1) * 0.15, // 0.15, 0.30, 0.45, 0.60, 0.75
			});
		}

		const result = await extractSubgraph(db, { maxNodes: 3 });

		expect(result.nodes).toHaveLength(3);
		// Top 3 by importance should be entities 4, 3, 2 (importance 0.75, 0.60, 0.45)
		const importances = result.nodes.map((n) => n.importance);
		for (let i = 0; i < importances.length - 1; i++) {
			const next = importances[i + 1] ?? 0;
			expect(importances[i]).toBeGreaterThanOrEqual(next);
		}
		expect(importances[0]).toBe(0.75);
	});

	// ---------------------------------------------------------------
	// Default mode: includes edges between extracted nodes
	// ---------------------------------------------------------------

	it("includes edges between extracted nodes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vis-edges", tmpDir);

		const eA = await insertEntity(db, {
			type: "Concept",
			name: "Node A",
			content: "A",
			summary: "A",
			importance: 0.9,
		});
		const eB = await insertEntity(db, {
			type: "Concept",
			name: "Node B",
			content: "B",
			summary: "B",
			importance: 0.8,
		});
		const eC = await insertEntity(db, {
			type: "Concept",
			name: "Node C",
			content: "C",
			summary: "C",
			importance: 0.7,
		});

		await insertEdge(db, { from_id: eA.id, to_id: eB.id, type: "relates_to", weight: 0.9 });
		await insertEdge(db, { from_id: eB.id, to_id: eC.id, type: "depends_on", weight: 0.5 });

		const result = await extractSubgraph(db, { maxNodes: 10 });

		expect(result.nodes).toHaveLength(3);
		expect(result.edges).toHaveLength(2);

		const edgeTypes = result.edges.map((e) => e.type).sort();
		expect(edgeTypes).toEqual(["depends_on", "relates_to"]);
	});

	// ---------------------------------------------------------------
	// Scope mode: scopes to path prefix
	// ---------------------------------------------------------------

	it("scopes to path prefix", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vis-scope", tmpDir);

		// Auth entities
		const authFile = await insertEntity(db, {
			type: "FileNode",
			name: "auth/login.ts",
			content: "auth login",
			summary: "Login file",
			file_paths: '["src/auth/login.ts"]',
			importance: 0.8,
		});
		await insertEntity(db, {
			type: "CodeEntity",
			name: "authenticateUser",
			content: "auth function",
			summary: "Auth function",
			file_paths: '["src/auth/middleware.ts"]',
			importance: 0.7,
		});

		// User entity (not auth)
		await insertEntity(db, {
			type: "FileNode",
			name: "user/profile.ts",
			content: "user profile",
			summary: "Profile file",
			file_paths: '["src/user/profile.ts"]',
			importance: 0.9,
		});

		// A neighbor of auth entity (Decision, linked via edge)
		const decision = await insertEntity(db, {
			type: "Decision",
			name: "Use JWT tokens",
			content: "JWT decision",
			summary: "Auth decision",
			importance: 0.6,
		});
		await insertEdge(db, { from_id: authFile.id, to_id: decision.id, type: "relates_to" });

		const result = await extractSubgraph(db, { scope: "src/auth/" });

		// Should include the 2 auth entities + the Decision neighbor
		const nodeNames = result.nodes.map((n) => n.name).sort();
		expect(nodeNames).toContain("auth/login.ts");
		expect(nodeNames).toContain("authenticateUser");
		expect(nodeNames).toContain("Use JWT tokens");
		// Should NOT include the user entity
		expect(nodeNames).not.toContain("user/profile.ts");
	});

	// ---------------------------------------------------------------
	// NodeType mode: filters by node type
	// ---------------------------------------------------------------

	it("filters by node type", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vis-type", tmpDir);

		const dec1 = await insertEntity(db, {
			type: "Decision",
			name: "Use REST",
			content: "REST decision",
			summary: "REST",
			importance: 0.8,
		});
		await insertEntity(db, {
			type: "Decision",
			name: "Use TypeScript",
			content: "TS decision",
			summary: "TypeScript",
			importance: 0.7,
		});
		await insertEntity(db, {
			type: "Concept",
			name: "Authentication",
			content: "Auth concept",
			summary: "Auth",
			importance: 0.9,
		});

		// Add a neighbor to a Decision
		const neighbor = await insertEntity(db, {
			type: "FileNode",
			name: "api/routes.ts",
			content: "routes",
			summary: "Routes file",
			importance: 0.5,
		});
		await insertEdge(db, { from_id: dec1.id, to_id: neighbor.id, type: "implemented_in" });

		const result = await extractSubgraph(db, { nodeType: "Decision" });

		// Should have both Decision entities + the FileNode neighbor
		const types = result.nodes.map((n) => n.type);
		const decisionCount = types.filter((t) => t === "Decision").length;
		expect(decisionCount).toBe(2);

		// The neighbor should also be included
		const names = result.nodes.map((n) => n.name);
		expect(names).toContain("api/routes.ts");

		// The unrelated Concept should NOT be included (it has no edge to a Decision)
		expect(names).not.toContain("Authentication");
	});

	// ---------------------------------------------------------------
	// Caps at maxNodes
	// ---------------------------------------------------------------

	it("caps at maxNodes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vis-cap", tmpDir);

		// Insert 10 entities
		for (let i = 0; i < 10; i++) {
			await insertEntity(db, {
				type: "Concept",
				name: `Cap Entity ${i}`,
				content: `Content ${i}`,
				summary: `Summary ${i}`,
				importance: (i + 1) * 0.08,
			});
		}

		const result = await extractSubgraph(db, { maxNodes: 5 });

		expect(result.nodes.length).toBeLessThanOrEqual(5);
	});

	// ---------------------------------------------------------------
	// No cap when maxNodes is undefined — loads all active nodes
	// ---------------------------------------------------------------

	it("loads all active nodes when maxNodes is undefined", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vis-no-cap", tmpDir);

		// Insert 10 entities
		for (let i = 0; i < 10; i++) {
			await insertEntity(db, {
				type: "Concept",
				name: `All Entity ${i}`,
				content: `Content ${i}`,
				summary: `Summary ${i}`,
				importance: (i + 1) * 0.08,
			});
		}

		const result = await extractSubgraph(db);

		expect(result.nodes).toHaveLength(10);
	});

	// ---------------------------------------------------------------
	// Result includes communities array
	// ---------------------------------------------------------------

	it("result includes communities array", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vis-communities", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Node with community",
			content: "content",
			summary: "summary",
			importance: 0.8,
		});

		const result = await extractSubgraph(db, { maxNodes: 10 });

		// communities should be an array (possibly empty if no community data)
		expect(Array.isArray(result.communities)).toBe(true);
	});
});
