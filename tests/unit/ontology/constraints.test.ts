import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { getAllConstraints, getConstraintsForType, validateEdge } from "@/ontology/constraints";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("ontology constraints", () => {
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
	// validateEdge — valid triple
	// ---------------------------------------------------------------

	it("validates a known valid edge triple", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("onto-valid-edge", tmpDir);

		const valid = await validateEdge(db, "Decision", "pertains_to", "CodeEntity");
		expect(valid).toBe(true);
	});

	// ---------------------------------------------------------------
	// validateEdge — invalid triple
	// ---------------------------------------------------------------

	it("rejects an invalid edge triple", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("onto-invalid-edge", tmpDir);

		const valid = await validateEdge(db, "Bug", "pertains_to", "Bug");
		expect(valid).toBe(false);
	});

	// ---------------------------------------------------------------
	// getConstraintsForType
	// ---------------------------------------------------------------

	it("returns constraints for a source type", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("onto-constraints-type", tmpDir);

		const constraints = await getConstraintsForType(db, "Decision");
		expect(constraints.length).toBeGreaterThanOrEqual(3);

		// All returned rows should have source_type = Decision
		for (const c of constraints) {
			expect(c.source_type).toBe("Decision");
		}

		// Should contain at least pertains_to, supersedes, and contradicts edge types
		const edgeTypes = constraints.map((c) => c.edge_type);
		expect(edgeTypes).toContain("pertains_to");
		expect(edgeTypes).toContain("supersedes");
		expect(edgeTypes).toContain("contradicts");
	});

	// ---------------------------------------------------------------
	// getAllConstraints
	// ---------------------------------------------------------------

	it("returns all constraints", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("onto-all-constraints", tmpDir);

		const all = await getAllConstraints(db);
		// 002_ontology.sql seeds many rows — verify we get at least 50
		expect(all.length).toBeGreaterThanOrEqual(50);

		// Every row should have the required fields populated
		for (const c of all) {
			expect(c.source_type).toBeTruthy();
			expect(c.edge_type).toBeTruthy();
			expect(c.target_type).toBeTruthy();
		}
	});
});
