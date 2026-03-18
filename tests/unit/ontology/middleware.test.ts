import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { getActiveEdges } from "@/graph/edges";
import { getEntity, insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { OntologyError } from "@/ontology/errors";
import { createBug, createConvention, createDecision, createSolution } from "@/ontology/middleware";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("ontology middleware", () => {
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
	// createBug — happy path
	// ---------------------------------------------------------------

	it("createBug creates entity + caused_by edge", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("mw-bug-ok", tmpDir);

		// Prerequisite: a CodeEntity the bug is caused by
		const codeEntity = await insertEntity(db, {
			type: "CodeEntity",
			name: "parseFoo",
			content: "function parseFoo() {}",
			summary: "Parser function",
		});

		const bug = await createBug(db, {
			name: "Off-by-one in parseFoo",
			content: "parseFoo returns wrong index",
			causedBy: codeEntity.id,
		});

		expect(bug.type).toBe("Bug");
		expect(bug.name).toBe("Off-by-one in parseFoo");
		expect(bug.id).toBeDefined();

		// Verify the caused_by edge was created
		const edges = await getActiveEdges(db, bug.id);
		expect(edges.length).toBeGreaterThanOrEqual(1);
		const causedByEdge = edges.find((e) => e.type === "caused_by");
		expect(causedByEdge).toBeDefined();
		expect(causedByEdge?.from_id).toBe(bug.id);
		expect(causedByEdge?.to_id).toBe(codeEntity.id);
	});

	// ---------------------------------------------------------------
	// createBug — missing causedBy
	// ---------------------------------------------------------------

	it("createBug throws without causedBy", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("mw-bug-err", tmpDir);

		await expect(
			createBug(db, {
				name: "Some bug",
				content: "Details",
				causedBy: "",
			}),
		).rejects.toThrow(OntologyError);
	});

	// ---------------------------------------------------------------
	// createConvention — happy path
	// ---------------------------------------------------------------

	it("createConvention creates entity + pertains_to edges", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("mw-conv-ok", tmpDir);

		// Prerequisite: two FileNode entities the convention pertains to
		const file1 = await insertEntity(db, {
			type: "FileNode",
			name: "src/utils.ts",
			content: "utility functions",
			summary: "Utilities",
		});
		const file2 = await insertEntity(db, {
			type: "FileNode",
			name: "src/helpers.ts",
			content: "helper functions",
			summary: "Helpers",
		});

		const convention = await createConvention(db, {
			name: "Use camelCase for functions",
			content: "All exported functions must use camelCase naming",
			pertainsTo: [file1.id, file2.id],
		});

		expect(convention.type).toBe("Convention");
		expect(convention.name).toBe("Use camelCase for functions");

		// Verify two pertains_to edges were created
		const edges = await getActiveEdges(db, convention.id);
		const pertainsEdges = edges.filter((e) => e.type === "pertains_to");
		expect(pertainsEdges).toHaveLength(2);

		const targetIds = pertainsEdges.map((e) => e.to_id).sort();
		expect(targetIds).toEqual([file1.id, file2.id].sort());
	});

	// ---------------------------------------------------------------
	// createConvention — empty pertainsTo
	// ---------------------------------------------------------------

	it("createConvention throws with empty pertainsTo", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("mw-conv-err", tmpDir);

		await expect(
			createConvention(db, {
				name: "Some convention",
				content: "Details",
				pertainsTo: [],
			}),
		).rejects.toThrow(OntologyError);
	});

	// ---------------------------------------------------------------
	// createDecision with supersedes — invalidates old
	// ---------------------------------------------------------------

	it("createDecision with supersedes invalidates old", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("mw-dec-supersede", tmpDir);

		// Create an old decision
		const oldDecision = await insertEntity(db, {
			type: "Decision",
			name: "Use REST",
			content: "We will use REST for the API",
			summary: "REST decision",
		});

		// Create new decision that supersedes the old one
		const newDecision = await createDecision(db, {
			name: "Use GraphQL",
			content: "We will use GraphQL instead of REST",
			supersedes: oldDecision.id,
		});

		expect(newDecision.type).toBe("Decision");
		expect(newDecision.name).toBe("Use GraphQL");

		// Verify the supersedes edge exists
		const edges = await getActiveEdges(db, newDecision.id);
		const supersedesEdge = edges.find((e) => e.type === "supersedes");
		expect(supersedesEdge).toBeDefined();
		expect(supersedesEdge?.from_id).toBe(newDecision.id);
		expect(supersedesEdge?.to_id).toBe(oldDecision.id);

		// Verify old decision was invalidated (t_valid_until set)
		const old = await getEntity(db, oldDecision.id);
		expect(old).toBeDefined();
		expect(old?.t_valid_until).not.toBeNull();
		expect(old?.t_expired).not.toBeNull();
	});

	// ---------------------------------------------------------------
	// createSolution — happy path
	// ---------------------------------------------------------------

	it("createSolution creates entity + solves edge", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("mw-sol-ok", tmpDir);

		// Prerequisite: a Bug the solution solves
		const bug = await insertEntity(db, {
			type: "Bug",
			name: "Memory leak",
			content: "Memory leak in event handler",
			summary: "Memory leak",
		});

		const solution = await createSolution(db, {
			name: "Fix memory leak",
			content: "Remove event listener on unmount",
			solves: bug.id,
		});

		expect(solution.type).toBe("Solution");

		// Verify the solves edge
		const edges = await getActiveEdges(db, solution.id);
		const solvesEdge = edges.find((e) => e.type === "solves");
		expect(solvesEdge).toBeDefined();
		expect(solvesEdge?.from_id).toBe(solution.id);
		expect(solvesEdge?.to_id).toBe(bug.id);
	});
});
