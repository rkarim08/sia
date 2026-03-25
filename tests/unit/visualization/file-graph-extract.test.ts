import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import {
	expandFolder,
	extractInitialGraph,
	getFileEntities,
	searchNodes,
} from "@/visualization/file-graph-extract";

describe("file-graph-extract", () => {
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
	// Test 1: builds folder combos from file paths
	// ---------------------------------------------------------------

	it("builds folder combos from file paths", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("file-graph-combos", tmpDir);

		await insertEntity(db, {
			type: "CodeEntity",
			name: "indexFile",
			content: "indexes files",
			summary: "function indexFile",
			file_paths: '["src/ast/indexer.ts"]',
			importance: 0.8,
		});
		await insertEntity(db, {
			type: "CodeEntity",
			name: "parseFile",
			content: "parses files",
			summary: "function parseFile",
			file_paths: '["src/ast/parser.ts"]',
			importance: 0.7,
		});
		await insertEntity(db, {
			type: "CodeEntity",
			name: "mcpServer",
			content: "mcp server",
			summary: "function mcpServer",
			file_paths: '["src/mcp/server.ts"]',
			importance: 0.6,
		});

		const result = await extractInitialGraph(db);

		const comboIds = result.combos.map((c) => c.id);
		expect(comboIds).toContain("combo:src/ast");
		expect(comboIds).toContain("combo:src/mcp");

		expect(result.nodes).toHaveLength(3);
		const filePaths = result.nodes.map((n) => n.filePath);
		expect(filePaths).toContain("src/ast/indexer.ts");
		expect(filePaths).toContain("src/ast/parser.ts");
		expect(filePaths).toContain("src/mcp/server.ts");
	});

	// ---------------------------------------------------------------
	// Test 2: includes knowledge nodes as standalone
	// ---------------------------------------------------------------

	it("includes knowledge nodes as standalone", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("file-graph-knowledge", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "Use SQLite",
			content: "We decided to use SQLite",
			summary: "Use SQLite for storage",
			file_paths: "[]",
			importance: 0.9,
		});
		await insertEntity(db, {
			type: "Bug",
			name: "Memory leak in parser",
			content: "Memory leak found",
			summary: "Memory leak in parser",
			file_paths: "[]",
			importance: 0.8,
		});

		const result = await extractInitialGraph(db);

		const decisionNode = result.nodes.find((n) => n.label === "Use SQLite");
		expect(decisionNode).toBeDefined();
		expect(decisionNode?.nodeType).toBe("decision");
		expect(decisionNode?.parentId).toBe("");

		const bugNode = result.nodes.find((n) => n.label === "Memory leak in parser");
		expect(bugNode).toBeDefined();
		expect(bugNode?.nodeType).toBe("bug");
		expect(bugNode?.parentId).toBe("");
	});

	// ---------------------------------------------------------------
	// Test 3: creates aggregated import edges between files
	// ---------------------------------------------------------------

	it("creates aggregated import edges between files", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("file-graph-edges", tmpDir);

		const entityA = await insertEntity(db, {
			type: "CodeEntity",
			name: "indexFile",
			content: "indexes files",
			summary: "function indexFile",
			file_paths: '["src/ast/indexer.ts"]',
			importance: 0.8,
		});
		const entityB = await insertEntity(db, {
			type: "CodeEntity",
			name: "parseFile",
			content: "parses files",
			summary: "function parseFile",
			file_paths: '["src/ast/parser.ts"]',
			importance: 0.7,
		});

		await insertEdge(db, { from_id: entityA.id, to_id: entityB.id, type: "imports" });

		const result = await extractInitialGraph(db);

		const sourceId = "file:src/ast/indexer.ts";
		const targetId = "file:src/ast/parser.ts";
		const importEdge = result.edges.find(
			(e) => e.source === sourceId && e.target === targetId,
		);
		expect(importEdge).toBeDefined();
		expect(importEdge?.edgeType).toBe("imports");
	});

	// ---------------------------------------------------------------
	// Test 4: respects scope parameter
	// ---------------------------------------------------------------

	it("respects scope parameter", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("file-graph-scope", tmpDir);

		await insertEntity(db, {
			type: "CodeEntity",
			name: "indexFile",
			content: "indexes files",
			summary: "function indexFile",
			file_paths: '["src/ast/indexer.ts"]',
			importance: 0.8,
		});
		await insertEntity(db, {
			type: "CodeEntity",
			name: "mcpServer",
			content: "mcp server",
			summary: "function mcpServer",
			file_paths: '["src/mcp/server.ts"]',
			importance: 0.6,
		});

		const result = await extractInitialGraph(db, { scope: "src/ast" });

		expect(result.nodes).toHaveLength(1);
		expect(result.nodes[0].filePath).toBe("src/ast/indexer.ts");
	});

	// ---------------------------------------------------------------
	// Test 5: expandFolder returns direct children
	// ---------------------------------------------------------------

	it("expandFolder returns direct children", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("file-graph-expand", tmpDir);

		await insertEntity(db, {
			type: "CodeEntity",
			name: "indexFile",
			content: "indexes files",
			summary: "function indexFile",
			file_paths: '["src/ast/indexer.ts"]',
			importance: 0.8,
		});
		await insertEntity(db, {
			type: "CodeEntity",
			name: "parseFile",
			content: "parses files",
			summary: "function parseFile",
			file_paths: '["src/ast/parser.ts"]',
			importance: 0.7,
		});

		const result = await expandFolder(db, "combo:src/ast");

		expect(result.nodes).toHaveLength(2);
		const filePaths = result.nodes.map((n) => n.filePath);
		expect(filePaths).toContain("src/ast/indexer.ts");
		expect(filePaths).toContain("src/ast/parser.ts");
	});

	// ---------------------------------------------------------------
	// Test 6: getFileEntities returns functions and classes
	// ---------------------------------------------------------------

	it("getFileEntities returns functions and classes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("file-graph-entities", tmpDir);

		await insertEntity(db, {
			type: "CodeEntity",
			name: "indexFile",
			content: "indexes files",
			summary: "function indexFile",
			file_paths: '["src/ast/indexer.ts"]',
			importance: 0.8,
		});
		await insertEntity(db, {
			type: "CodeEntity",
			name: "Indexer",
			content: "Indexer class",
			summary: "class Indexer",
			file_paths: '["src/ast/indexer.ts"]',
			importance: 0.7,
		});

		const result = await getFileEntities(db, "src/ast/indexer.ts");

		expect(result.nodes).toHaveLength(2);
		const nodeTypes = result.nodes.map((n) => n.nodeType);
		expect(nodeTypes).toContain("function");
		expect(nodeTypes).toContain("class");
	});

	// ---------------------------------------------------------------
	// Test 7: searchNodes finds by name substring
	// ---------------------------------------------------------------

	it("searchNodes finds by name substring", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("file-graph-search", tmpDir);

		await insertEntity(db, {
			type: "CodeEntity",
			name: "indexFile",
			content: "indexes files",
			summary: "function indexFile",
			file_paths: '["src/ast/indexer.ts"]',
			importance: 0.8,
		});
		await insertEntity(db, {
			type: "CodeEntity",
			name: "parseFile",
			content: "parses files",
			summary: "function parseFile",
			file_paths: '["src/ast/parser.ts"]',
			importance: 0.7,
		});

		const results = await searchNodes(db, "index");

		expect(results.length).toBeGreaterThanOrEqual(1);
		const found = results.find((r) => r.name === "indexFile");
		expect(found).toBeDefined();
		expect(found?.comboAncestry).toContain("combo:src/ast");
	});
});
