import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { getActiveEdges } from "@/graph/edges";
import { getEntity, insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaNote } from "@/mcp/tools/sia-note";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("sia_note tool", () => {
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
	// Creates a Decision with relates_to
	// ---------------------------------------------------------------

	it("creates a Decision with relates_to", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("note-decision", tmpDir);

		// Prerequisite: a CodeEntity the decision pertains to
		const codeEntity = await insertEntity(db, {
			type: "CodeEntity",
			name: "AuthModule",
			content: "Authentication module",
			summary: "Auth module",
		});

		const result = await handleSiaNote(db, {
			kind: "Decision",
			name: "Use JWT for auth",
			content: "We will use JWT tokens for authentication",
			relates_to: [codeEntity.id],
		});

		expect(result.kind).toBe("Decision");
		expect(result.node_id).toBeDefined();
		expect(result.edges_created).toBe(1);

		// Verify the entity was created with correct type
		const entity = await getEntity(db, result.node_id);
		expect(entity).toBeDefined();
		expect(entity?.type).toBe("Decision");
		expect(entity?.name).toBe("Use JWT for auth");

		// Verify pertains_to edge exists
		const edges = await getActiveEdges(db, result.node_id);
		const pertainsEdge = edges.find((e) => e.type === "pertains_to");
		expect(pertainsEdge).toBeDefined();
		expect(pertainsEdge?.from_id).toBe(result.node_id);
		expect(pertainsEdge?.to_id).toBe(codeEntity.id);
	});

	// ---------------------------------------------------------------
	// Creates a Bug with causedBy from relates_to[0]
	// ---------------------------------------------------------------

	it("creates a Bug with causedBy from relates_to[0]", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("note-bug", tmpDir);

		// Prerequisite: a FileNode the bug is caused by
		const fileNode = await insertEntity(db, {
			type: "FileNode",
			name: "src/parser.ts",
			content: "Parser implementation",
			summary: "Parser file",
		});

		const result = await handleSiaNote(db, {
			kind: "Bug",
			name: "Parser off-by-one",
			content: "Parser returns wrong index for nested expressions",
			relates_to: [fileNode.id],
		});

		expect(result.kind).toBe("Bug");
		expect(result.node_id).toBeDefined();
		expect(result.edges_created).toBe(1);

		// Verify caused_by edge
		const edges = await getActiveEdges(db, result.node_id);
		const causedByEdge = edges.find((e) => e.type === "caused_by");
		expect(causedByEdge).toBeDefined();
		expect(causedByEdge?.from_id).toBe(result.node_id);
		expect(causedByEdge?.to_id).toBe(fileNode.id);
	});

	// ---------------------------------------------------------------
	// Creates a Convention requiring relates_to
	// ---------------------------------------------------------------

	it("creates a Convention with relates_to", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("note-convention", tmpDir);

		// Prerequisite: a CodeEntity the convention pertains to
		const codeEntity = await insertEntity(db, {
			type: "CodeEntity",
			name: "formatUtils",
			content: "Formatting utility functions",
			summary: "Formatter utils",
		});

		const result = await handleSiaNote(db, {
			kind: "Convention",
			name: "Use camelCase for functions",
			content: "All exported functions must use camelCase naming",
			relates_to: [codeEntity.id],
			tags: ["naming", "style"],
		});

		expect(result.kind).toBe("Convention");
		expect(result.node_id).toBeDefined();
		expect(result.edges_created).toBe(1);

		// Verify entity and edge
		const entity = await getEntity(db, result.node_id);
		expect(entity).toBeDefined();
		expect(entity?.type).toBe("Convention");

		const edges = await getActiveEdges(db, result.node_id);
		const pertainsEdge = edges.find((e) => e.type === "pertains_to");
		expect(pertainsEdge).toBeDefined();
		expect(pertainsEdge?.to_id).toBe(codeEntity.id);
	});

	// ---------------------------------------------------------------
	// Throws for Convention without relates_to
	// ---------------------------------------------------------------

	it("throws for Convention without relates_to", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("note-conv-err", tmpDir);

		await expect(
			handleSiaNote(db, {
				kind: "Convention",
				name: "Some convention",
				content: "Details about the convention",
				relates_to: [],
			}),
		).rejects.toThrow("sia_note failed");
	});

	// ---------------------------------------------------------------
	// Creates a Solution with solves edge
	// ---------------------------------------------------------------

	it("creates a Solution with solves edge", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("note-solution", tmpDir);

		// Prerequisite: a Bug entity the solution solves
		const bug = await insertEntity(db, {
			type: "Bug",
			name: "Memory leak in handler",
			content: "Event handler not cleaned up on unmount",
			summary: "Memory leak",
		});

		const result = await handleSiaNote(db, {
			kind: "Solution",
			name: "Fix memory leak",
			content: "Remove event listener in cleanup callback",
			relates_to: [bug.id],
		});

		expect(result.kind).toBe("Solution");
		expect(result.node_id).toBeDefined();
		expect(result.edges_created).toBe(1);

		// Verify solves edge
		const edges = await getActiveEdges(db, result.node_id);
		const solvesEdge = edges.find((e) => e.type === "solves");
		expect(solvesEdge).toBeDefined();
		expect(solvesEdge?.from_id).toBe(result.node_id);
		expect(solvesEdge?.to_id).toBe(bug.id);
	});

	// ---------------------------------------------------------------
	// Creates a Decision with supersedes
	// ---------------------------------------------------------------

	it("creates a Decision with supersedes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("note-supersede", tmpDir);

		// Create the old decision entity directly
		const oldDecision = await insertEntity(db, {
			type: "Decision",
			name: "Use REST API",
			content: "We will use REST for the API layer",
			summary: "REST decision",
		});

		const result = await handleSiaNote(db, {
			kind: "Decision",
			name: "Use GraphQL",
			content: "We will use GraphQL instead of REST for the API layer",
			supersedes: oldDecision.id,
		});

		expect(result.kind).toBe("Decision");
		expect(result.node_id).toBeDefined();
		expect(result.edges_created).toBe(1); // supersedes edge only

		// Verify supersedes edge
		const edges = await getActiveEdges(db, result.node_id);
		const supersedesEdge = edges.find((e) => e.type === "supersedes");
		expect(supersedesEdge).toBeDefined();
		expect(supersedesEdge?.from_id).toBe(result.node_id);
		expect(supersedesEdge?.to_id).toBe(oldDecision.id);

		// Verify old decision was invalidated
		const old = await getEntity(db, oldDecision.id);
		expect(old).toBeDefined();
		expect(old?.t_valid_until).not.toBeNull();
		expect(old?.t_expired).not.toBeNull();
	});
});
