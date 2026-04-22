import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { createVizApiServer, type VizServer } from "@/visualization/viz-api-server";

describe("viz-api-server", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;
	let server: VizServer | undefined;
	let baseUrl: string;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-viz-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	beforeEach(async () => {
		tmpDir = makeTmp();
		db = openGraphDb(`viz-api-test-${randomUUID()}`, tmpDir);

		// Insert a test entity
		await insertEntity(db, {
			type: "CodeEntity",
			name: "indexFile",
			content: "indexes files by path",
			summary: "function indexFile",
			file_paths: '["src/ast/indexer.ts"]',
			importance: 0.8,
		});

		// Create a fake project with a source file
		const projectRoot = join(tmpDir, "project");
		mkdirSync(join(projectRoot, "src/ast"), { recursive: true });
		writeFileSync(
			join(projectRoot, "src/ast/indexer.ts"),
			"export function indexFile(path: string) {\n  return path;\n}\n",
		);

		server = await createVizApiServer(db, projectRoot, 0);
		baseUrl = `http://localhost:${server.port}`;
	});

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
		}
	});

	it("GET / returns HTML with root element", async () => {
		const res = await fetch(`${baseUrl}/`);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("<!DOCTYPE html>");
		expect(text).toContain('<div id="root">');
	});

	it("GET /api/graph returns graph data", async () => {
		const res = await fetch(`${baseUrl}/api/graph`);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { nodes: unknown[]; edges: unknown[]; combos: unknown[] };
		expect(Array.isArray(data.nodes)).toBe(true);
		expect(Array.isArray(data.edges)).toBe(true);
		expect(Array.isArray(data.combos)).toBe(true);
		expect(data.nodes.length).toBeGreaterThanOrEqual(1);
	});

	it("GET /api/file returns source code", async () => {
		const res = await fetch(`${baseUrl}/api/file?path=src/ast/indexer.ts`);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { content: string; language: string; lineCount: number };
		expect(data.content).toContain("export function indexFile");
		expect(data.language).toBe("typescript");
		expect(data.lineCount).toBe(3);
	});

	it("GET /api/file rejects path traversal", async () => {
		const res = await fetch(`${baseUrl}/api/file?path=../../etc/passwd`);
		expect(res.status).toBe(400);
	});

	it("GET /api/search returns results", async () => {
		const res = await fetch(`${baseUrl}/api/search?q=index`);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { results: Array<{ name: string }> };
		expect(Array.isArray(data.results)).toBe(true);
		expect(data.results[0].name).toBe("indexFile");
	});

	it("GET /health returns ok", async () => {
		const res = await fetch(`${baseUrl}/health`);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { status: string };
		expect(data.status).toBe("ok");
	});
});
