import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatFreshnessReport, generateFreshnessReport } from "@/cli/commands/freshness";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("freshness CLI command", () => {
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
	// generateFreshnessReport returns all required fields
	// ---------------------------------------------------------------

	it("generateFreshnessReport returns all required fields", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("freshness-fields", tmpDir);

		const report = await generateFreshnessReport(db);

		expect(report).toHaveProperty("totalNodes");
		expect(report).toHaveProperty("freshNodes");
		expect(report).toHaveProperty("staleNodes");
		expect(report).toHaveProperty("rottenNodes");
		expect(report).toHaveProperty("pendingRevalidation");
		expect(report).toHaveProperty("avgConfidenceByTier");
		expect(report).toHaveProperty("lastDeepValidation");
		expect(report).toHaveProperty("indexCoverage");
		expect(report).toHaveProperty("nativeModuleStatus");

		expect(typeof report.totalNodes).toBe("number");
		expect(typeof report.freshNodes).toBe("number");
		expect(typeof report.staleNodes).toBe("number");
		expect(typeof report.rottenNodes).toBe("number");
		expect(typeof report.pendingRevalidation).toBe("number");
		expect(typeof report.avgConfidenceByTier).toBe("object");
		expect(typeof report.indexCoverage).toBe("number");
		expect(typeof report.nativeModuleStatus).toBe("string");
	});

	// ---------------------------------------------------------------
	// reports correct counts from test data
	// ---------------------------------------------------------------

	it("reports correct counts from test data", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("freshness-counts", tmpDir);

		// Insert 3 entities with varying confidence levels
		// High confidence (> 0.7) → fresh
		await insertEntity(db, {
			type: "Concept",
			name: "Fresh Node",
			content: "High confidence node",
			summary: "Fresh node",
			confidence: 0.9,
		});

		// Medium confidence (0.3–0.7) → stale
		await db.execute("UPDATE graph_nodes SET confidence = 0.5 WHERE name = 'Fresh Node'", []);

		// Wait a tick then insert stale and rotten nodes
		await insertEntity(db, {
			type: "Concept",
			name: "Stale Node",
			content: "Medium confidence node",
			summary: "Stale node",
			confidence: 0.5,
		});

		await insertEntity(db, {
			type: "Concept",
			name: "Rotten Node",
			content: "Low confidence node",
			summary: "Rotten node",
			confidence: 0.2,
		});

		// Update confidence directly via SQL to ensure specific values
		await db.execute("UPDATE graph_nodes SET confidence = 0.5 WHERE name = 'Stale Node'", []);
		await db.execute("UPDATE graph_nodes SET confidence = 0.2 WHERE name = 'Rotten Node'", []);

		const report = await generateFreshnessReport(db);

		expect(report.totalNodes).toBe(3);
		// fresh: confidence > 0.7 → none (all were set to ≤ 0.7)
		// stale: 0.3–0.7 → 2 (0.5 and 0.5)
		// rotten: < 0.3 → 1 (0.2)
		expect(report.staleNodes).toBe(2);
		expect(report.rottenNodes).toBe(1);
		expect(report.freshNodes + report.staleNodes + report.rottenNodes).toBe(3);
	});

	// ---------------------------------------------------------------
	// index coverage calculation
	// ---------------------------------------------------------------

	it("index coverage is 0 when no source mappings exist", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("freshness-coverage-empty", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Node Without Source",
			content: "No source mapping",
			summary: "No source",
		});

		const report = await generateFreshnessReport(db);

		expect(report.totalNodes).toBe(1);
		expect(report.indexCoverage).toBe(0);
	});

	it("index coverage is 100 when all nodes have source mappings", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("freshness-coverage-full", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Node With Source",
			content: "Has source mapping",
			summary: "Has source",
		});

		// Insert a source_deps mapping for this entity
		await db.execute(
			"INSERT INTO source_deps (source_path, node_id, dep_type, source_mtime) VALUES (?, ?, ?, ?)",
			["/path/to/file.ts", entity.id, "defines", Date.now()],
		);

		const report = await generateFreshnessReport(db);

		expect(report.totalNodes).toBe(1);
		expect(report.indexCoverage).toBe(100);
	});

	it("index coverage is partial when only some nodes have mappings", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("freshness-coverage-partial", tmpDir);

		const entity1 = await insertEntity(db, {
			type: "Concept",
			name: "Node With Source",
			content: "Has source mapping",
			summary: "Has source",
		});

		await insertEntity(db, {
			type: "Concept",
			name: "Node Without Source",
			content: "No source mapping",
			summary: "No source",
		});

		// Only entity1 gets a source mapping
		await db.execute(
			"INSERT INTO source_deps (source_path, node_id, dep_type, source_mtime) VALUES (?, ?, ?, ?)",
			["/path/to/file.ts", entity1.id, "defines", Date.now()],
		);

		const report = await generateFreshnessReport(db);

		expect(report.totalNodes).toBe(2);
		expect(report.indexCoverage).toBe(50);
	});

	// ---------------------------------------------------------------
	// formatFreshnessReport produces readable output
	// ---------------------------------------------------------------

	it("formatFreshnessReport produces human-readable output", async () => {
		const report = {
			totalNodes: 1234,
			freshNodes: 1100,
			staleNodes: 120,
			rottenNodes: 14,
			pendingRevalidation: 5,
			avgConfidenceByTier: {
				"1": 0.92,
				"2": 0.98,
				"3": 0.71,
				"4": 0.45,
			},
			lastDeepValidation: new Date("2026-03-17T22:00:00Z").getTime(),
			indexCoverage: 87.3,
			nativeModuleStatus: "typescript",
		};

		const output = formatFreshnessReport(report);

		expect(output).toContain("Sia Graph Freshness Report");
		expect(output).toContain("1,234");
		expect(output).toContain("1,100");
		expect(output).toContain("120");
		expect(output).toContain("14");
		expect(output).toContain("Fresh");
		expect(output).toContain("Stale");
		expect(output).toContain("Rotten");
		expect(output).toContain("Index Coverage");
		expect(output).toContain("Native Module");
		expect(output).toContain("typescript");
		expect(output).toContain("87");
	});

	it("formatFreshnessReport shows null last deep validation", () => {
		const report = {
			totalNodes: 0,
			freshNodes: 0,
			staleNodes: 0,
			rottenNodes: 0,
			pendingRevalidation: 0,
			avgConfidenceByTier: {},
			lastDeepValidation: null,
			indexCoverage: 0,
			nativeModuleStatus: "typescript",
		};

		const output = formatFreshnessReport(report);

		expect(output).toContain("never");
	});

	it("formatFreshnessReport shows confidence tiers", () => {
		const report = {
			totalNodes: 100,
			freshNodes: 80,
			staleNodes: 15,
			rottenNodes: 5,
			pendingRevalidation: 2,
			avgConfidenceByTier: {
				"1": 0.95,
				"3": 0.72,
			},
			lastDeepValidation: null,
			indexCoverage: 60,
			nativeModuleStatus: "native",
		};

		const output = formatFreshnessReport(report);

		expect(output).toContain("Confidence by Trust Tier");
		expect(output).toContain("0.95");
		expect(output).toContain("0.72");
		expect(output).toContain("native");
	});
});
