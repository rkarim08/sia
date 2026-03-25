import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scoreEntryPoints } from "@/ast/entry-point-scorer";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-ep-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("entry point scorer", () => {
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
	// Exported function with "handle" prefix scores > 0.7
	// ---------------------------------------------------------------

	it("exported function with handle prefix scores > 0.7", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ep-handle", tmpDir);

		await insertEntity(db, {
			type: "CodeEntity",
			name: "handleRequest",
			content: "export function handleRequest() {}",
			summary: "Handler for incoming requests",
			tags: JSON.stringify(["isExported"]),
			file_paths: JSON.stringify(["src/server.ts"]),
		});

		const scores = await scoreEntryPoints(db);
		expect(scores.length).toBeGreaterThanOrEqual(1);

		const handleScore = scores.find((s) => s.reasons.length > 0);
		expect(handleScore).toBeDefined();
		expect(handleScore?.score).toBeGreaterThan(0.7);
	});

	// ---------------------------------------------------------------
	// Non-exported internal function scores < 0.3
	// ---------------------------------------------------------------

	it("non-exported internal function scores < 0.3", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ep-internal", tmpDir);

		await insertEntity(db, {
			type: "CodeEntity",
			name: "parseInternalData",
			content: "function parseInternalData() {}",
			summary: "Internal data parser",
			tags: JSON.stringify([]),
			file_paths: JSON.stringify(["src/utils.ts"]),
		});

		const scores = await scoreEntryPoints(db);
		const internalScore = scores.find((s) => s.entityId !== undefined);
		expect(internalScore).toBeDefined();
		expect(internalScore?.score).toBeLessThan(0.3);
	});

	// ---------------------------------------------------------------
	// Function named "main" or "index" scores > 0.8
	// ---------------------------------------------------------------

	it("function named main scores > 0.8", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ep-main", tmpDir);

		await insertEntity(db, {
			type: "CodeEntity",
			name: "main",
			content: "export function main() {}",
			summary: "Main entry point",
			tags: JSON.stringify(["isExported"]),
			file_paths: JSON.stringify(["src/index.ts"]),
		});

		const scores = await scoreEntryPoints(db);
		const mainScore = scores.find((s) => s.reasons.some((r) => r.includes("main")));
		expect(mainScore).toBeDefined();
		expect(mainScore?.score).toBeGreaterThan(0.8);
	});

	it("function named index scores > 0.8", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ep-index", tmpDir);

		await insertEntity(db, {
			type: "CodeEntity",
			name: "index",
			content: "export function index() {}",
			summary: "Index entry point",
			tags: JSON.stringify(["isExported"]),
			file_paths: JSON.stringify(["src/index.ts"]),
		});

		const scores = await scoreEntryPoints(db);
		const indexScore = scores.find((s) => s.reasons.some((r) => r.includes("index")));
		expect(indexScore).toBeDefined();
		expect(indexScore?.score).toBeGreaterThan(0.8);
	});

	// ---------------------------------------------------------------
	// Function with framework decorator pattern scores > 0.8
	// ---------------------------------------------------------------

	it("function with framework hint tags scores > 0.8", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ep-framework", tmpDir);

		await insertEntity(db, {
			type: "CodeEntity",
			name: "getUsers",
			content: "export function getUsers() {}",
			summary: "Get users route handler",
			tags: JSON.stringify(["isExported", "route", "handler"]),
			file_paths: JSON.stringify(["src/routes/users.ts"]),
		});

		const scores = await scoreEntryPoints(db);
		const frameworkScore = scores.find((s) =>
			s.reasons.some((r) => r.toLowerCase().includes("framework")),
		);
		expect(frameworkScore).toBeDefined();
		expect(frameworkScore?.score).toBeGreaterThan(0.8);
	});

	// ---------------------------------------------------------------
	// Function with high call ratio scores higher
	// ---------------------------------------------------------------

	it("function with high inDegree/outDegree ratio scores higher", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ep-callratio", tmpDir);

		// Create a function with high call ratio (many callers, few callees)
		const highRatio = await insertEntity(db, {
			type: "CodeEntity",
			name: "processRequest",
			content: "export function processRequest() {}",
			summary: "Process request handler",
			tags: JSON.stringify(["isExported"]),
			file_paths: JSON.stringify(["src/api.ts"]),
		});

		// Create callers (inDegree sources)
		const caller1 = await insertEntity(db, {
			type: "CodeEntity",
			name: "routeA",
			content: "function routeA() { processRequest() }",
			summary: "Route A",
			tags: JSON.stringify([]),
			file_paths: JSON.stringify(["src/routes.ts"]),
		});
		const caller2 = await insertEntity(db, {
			type: "CodeEntity",
			name: "routeB",
			content: "function routeB() { processRequest() }",
			summary: "Route B",
			tags: JSON.stringify([]),
			file_paths: JSON.stringify(["src/routes.ts"]),
		});
		const caller3 = await insertEntity(db, {
			type: "CodeEntity",
			name: "routeC",
			content: "function routeC() { processRequest() }",
			summary: "Route C",
			tags: JSON.stringify([]),
			file_paths: JSON.stringify(["src/routes.ts"]),
		});

		// Edges: callers -> highRatio (inDegree = 3)
		await insertEdge(db, { from_id: caller1.id, to_id: highRatio.id, type: "calls" });
		await insertEdge(db, { from_id: caller2.id, to_id: highRatio.id, type: "calls" });
		await insertEdge(db, { from_id: caller3.id, to_id: highRatio.id, type: "calls" });

		// Create a function with low call ratio (many callees, few callers)
		const lowRatio = await insertEntity(db, {
			type: "CodeEntity",
			name: "helperUtil",
			content: "function helperUtil() {}",
			summary: "Utility helper",
			tags: JSON.stringify([]),
			file_paths: JSON.stringify(["src/utils.ts"]),
		});

		// Edges: lowRatio -> others (outDegree = 3)
		await insertEdge(db, { from_id: lowRatio.id, to_id: caller1.id, type: "calls" });
		await insertEdge(db, { from_id: lowRatio.id, to_id: caller2.id, type: "calls" });
		await insertEdge(db, { from_id: lowRatio.id, to_id: caller3.id, type: "calls" });

		const scores = await scoreEntryPoints(db);
		const highScore = scores.find((s) => s.entityId === highRatio.id);
		const lowScore = scores.find((s) => s.entityId === lowRatio.id);

		expect(highScore).toBeDefined();
		expect(lowScore).toBeDefined();
		expect(highScore!.score).toBeGreaterThan(lowScore!.score);
	});

	// ---------------------------------------------------------------
	// Scores are written to graph_nodes.entry_point_score
	// ---------------------------------------------------------------

	it("writes scores to graph_nodes.entry_point_score", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ep-persist", tmpDir);

		const entity = await insertEntity(db, {
			type: "CodeEntity",
			name: "handleEvent",
			content: "export function handleEvent() {}",
			summary: "Event handler",
			tags: JSON.stringify(["isExported"]),
			file_paths: JSON.stringify(["src/events.ts"]),
		});

		await scoreEntryPoints(db);

		const result = await db.execute("SELECT entry_point_score FROM graph_nodes WHERE id = ?", [
			entity.id,
		]);
		expect(result.rows.length).toBe(1);
		expect(result.rows[0].entry_point_score).not.toBeNull();
		expect(typeof result.rows[0].entry_point_score).toBe("number");
	});
});
