// tests/integration/viz-api-e2e.test.ts
// End-to-end integration test for the visualizer API workflow.

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import type { VizServer } from "@/visualization/viz-api-server";
import { createVizApiServer } from "@/visualization/viz-api-server";

describe("viz-api-e2e", () => {
	let tmpDir: string | undefined;
	let db: SiaDb | undefined;
	let server: VizServer | undefined;

	afterEach(async () => {
		if (server) {
			server.stop(true);
			server = undefined;
		}
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
			tmpDir = undefined;
		}
	});

	it("full workflow: graph -> expand -> entities -> file -> search", async () => {
		// Setup: temp dir and DB
		tmpDir = join(tmpdir(), `sia-viz-e2e-${randomUUID()}`);
		mkdirSync(tmpDir, { recursive: true });
		db = openGraphDb("viz-e2e", tmpDir);

		// Insert 2 CodeEntities in different folders
		const indexFileEntity = await insertEntity(db, {
			type: "CodeEntity",
			name: "indexFile",
			content: "function indexFile",
			summary: "function indexFile",
			file_paths: '["src/ast/indexer.ts"]',
			importance: 0.9,
		});

		const startServerEntity = await insertEntity(db, {
			type: "CodeEntity",
			name: "startServer",
			content: "function startServer",
			summary: "function startServer",
			file_paths: '["src/mcp/server.ts"]',
			importance: 0.8,
		});

		// Insert an import edge between them
		await insertEdge(db, {
			from_id: indexFileEntity.id,
			to_id: startServerEntity.id,
			type: "imports",
		});

		// Insert a Decision entity
		await insertEntity(db, {
			type: "Decision",
			name: "Use G6 for visualization",
			content: "Use G6 v5",
			summary: "Use G6 v5",
			importance: 0.7,
			kind: "Decision",
		});

		// Create fake project files on disk
		const projectRoot = join(tmpDir, "project");
		mkdirSync(join(projectRoot, "src/ast"), { recursive: true });
		mkdirSync(join(projectRoot, "src/mcp"), { recursive: true });
		writeFileSync(
			join(projectRoot, "src/ast/indexer.ts"),
			"export function indexFile(path: string): void {\n  console.log(path);\n}\n",
		);

		// Start server on random port
		server = await createVizApiServer(db, projectRoot, 0);
		const baseUrl = `http://localhost:${server.port}`;

		// 1. GET /api/graph — combos.length >= 2, nodes.length >= 3
		const graphRes = await fetch(`${baseUrl}/api/graph`);
		expect(graphRes.status).toBe(200);
		const graphData = (await graphRes.json()) as {
			nodes: unknown[];
			edges: unknown[];
			combos: unknown[];
		};
		expect(graphData.combos.length).toBeGreaterThanOrEqual(2);
		expect(graphData.nodes.length).toBeGreaterThanOrEqual(3);

		// 2. GET /api/expand/combo:src/ast — nodes.length >= 1
		const expandRes = await fetch(`${baseUrl}/api/expand/combo:src%2Fast`);
		expect(expandRes.status).toBe(200);
		const expandData = (await expandRes.json()) as { nodes: unknown[] };
		expect(expandData.nodes.length).toBeGreaterThanOrEqual(1);

		// 3. GET /api/entities/file:src/ast/indexer.ts — nodes.length >= 1
		const entitiesRes = await fetch(`${baseUrl}/api/entities/file:src%2Fast%2Findexer.ts`);
		expect(entitiesRes.status).toBe(200);
		const entitiesData = (await entitiesRes.json()) as { nodes: unknown[] };
		expect(entitiesData.nodes.length).toBeGreaterThanOrEqual(1);

		// 4. GET /api/file?path=src/ast/indexer.ts — content, language
		const fileRes = await fetch(`${baseUrl}/api/file?path=src/ast/indexer.ts`);
		expect(fileRes.status).toBe(200);
		const fileData = (await fileRes.json()) as {
			content: string;
			language: string;
			lineCount: number;
		};
		expect(fileData.content).toContain("export function indexFile");
		expect(fileData.language).toBe("typescript");

		// 5. GET /api/search?q=index — results.length >= 1
		const searchRes = await fetch(`${baseUrl}/api/search?q=index`);
		expect(searchRes.status).toBe(200);
		const searchData = (await searchRes.json()) as { results: unknown[] };
		expect(searchData.results.length).toBeGreaterThanOrEqual(1);

		// 6. GET / — HTML with "g6"
		const rootRes = await fetch(`${baseUrl}/`);
		expect(rootRes.status).toBe(200);
		const html = await rootRes.text();
		expect(html.toLowerCase()).toContain("g6");
	});
});
