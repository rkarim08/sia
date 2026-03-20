import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { importFromMarkdown } from "@/knowledge/markdown-import";

describe("markdown import", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-md-import-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	/** Helper to create a markdown file with optional frontmatter + body. */
	function writeMd(dir: string, relPath: string, content: string): void {
		const fullPath = join(dir, relPath);
		mkdirSync(join(fullPath, ".."), { recursive: true });
		writeFileSync(fullPath, content, "utf-8");
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
	// imports markdown files as entities
	// ---------------------------------------------------------------

	it("imports markdown files as entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("md-import-basic", tmpDir);

		const vaultDir = join(tmpDir, "vault");
		writeMd(
			vaultDir,
			"decisions/use-jwt.md",
			[
				"---",
				"id: abc-123",
				"kind: Decision",
				"trust_tier: 2",
				"created_at: 2025-01-15T00:00:00.000Z",
				"tags: [auth, security]",
				"importance: 0.9",
				"---",
				"",
				"# Use JWT for Auth",
				"",
				"We decided to use JWT for authentication.",
			].join("\n"),
		);

		const result = await importFromMarkdown(db, vaultDir);

		expect(result.entitiesImported).toBe(1);
		expect(result.errors).toHaveLength(0);

		// Verify entity in database
		const { rows } = await db.execute(
			"SELECT * FROM graph_nodes WHERE extraction_method = 'markdown-import'",
		);
		expect(rows).toHaveLength(1);

		const entity = rows[0] as Record<string, unknown>;
		expect(entity.type).toBe("Decision");
		expect(entity.name).toBe("Use JWT for Auth");
		expect(entity.content).toBe("We decided to use JWT for authentication.");
		expect(entity.trust_tier).toBe(2);
		expect(entity.importance).toBe(0.9);
	});

	// ---------------------------------------------------------------
	// parses YAML frontmatter metadata
	// ---------------------------------------------------------------

	it("parses YAML frontmatter metadata", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("md-import-frontmatter", tmpDir);

		const vaultDir = join(tmpDir, "vault");
		writeMd(
			vaultDir,
			"conventions/code-style.md",
			[
				"---",
				"kind: Convention",
				"trust_tier: 1",
				"tags: [style, lint, typescript]",
				"importance: 0.75",
				"---",
				"",
				"# Code Style Convention",
				"",
				"Use tabs for indentation. Strict TypeScript mode.",
			].join("\n"),
		);

		const result = await importFromMarkdown(db, vaultDir);

		expect(result.entitiesImported).toBe(1);
		expect(result.errors).toHaveLength(0);

		const { rows } = await db.execute(
			"SELECT * FROM graph_nodes WHERE extraction_method = 'markdown-import'",
		);
		const entity = rows[0] as Record<string, unknown>;
		expect(entity.type).toBe("Convention");
		expect(entity.trust_tier).toBe(1);
		expect(entity.importance).toBe(0.75);

		const tags = JSON.parse(entity.tags as string) as string[];
		expect(tags).toContain("style");
		expect(tags).toContain("lint");
		expect(tags).toContain("typescript");
	});

	// ---------------------------------------------------------------
	// resolves wikilinks to edges
	// ---------------------------------------------------------------

	it("resolves wikilinks to edges", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("md-import-wikilinks", tmpDir);

		const vaultDir = join(tmpDir, "vault");
		writeMd(
			vaultDir,
			"decisions/use-jwt.md",
			[
				"---",
				"kind: Decision",
				"trust_tier: 2",
				"tags: []",
				"importance: 0.8",
				"---",
				"",
				"# Use JWT",
				"",
				"We decided to use JWT for authentication.",
				"",
				"## Related",
				"",
				"- pertains_to: [[concepts/auth-flow]]",
			].join("\n"),
		);

		writeMd(
			vaultDir,
			"concepts/auth-flow.md",
			[
				"---",
				"kind: Concept",
				"trust_tier: 2",
				"tags: []",
				"importance: 0.7",
				"---",
				"",
				"# Auth Flow",
				"",
				"The authentication flow uses JWT tokens.",
			].join("\n"),
		);

		const result = await importFromMarkdown(db, vaultDir);

		expect(result.entitiesImported).toBe(2);
		expect(result.edgesCreated).toBe(1);
		expect(result.errors).toHaveLength(0);

		// Verify edge exists
		const { rows: edges } = await db.execute(
			"SELECT * FROM graph_edges WHERE extraction_method = 'markdown-import'",
		);
		expect(edges).toHaveLength(1);

		const edge = edges[0] as Record<string, unknown>;
		expect(edge.type).toBe("pertains_to");
	});

	// ---------------------------------------------------------------
	// handles missing frontmatter gracefully
	// ---------------------------------------------------------------

	it("handles missing frontmatter gracefully", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("md-import-no-frontmatter", tmpDir);

		const vaultDir = join(tmpDir, "vault");
		writeMd(
			vaultDir,
			"concepts/plain-doc.md",
			[
				"# Plain Document",
				"",
				"This file has no frontmatter at all.",
				"It should still be importable with defaults.",
			].join("\n"),
		);

		const result = await importFromMarkdown(db, vaultDir);

		expect(result.entitiesImported).toBe(1);
		expect(result.errors).toHaveLength(0);

		const { rows } = await db.execute(
			"SELECT * FROM graph_nodes WHERE extraction_method = 'markdown-import'",
		);
		const entity = rows[0] as Record<string, unknown>;
		// Type inferred from parent directory "concepts"
		expect(entity.type).toBe("Concept");
		expect(entity.name).toBe("Plain Document");
		// Default trust_tier for import is 1
		expect(entity.trust_tier).toBe(1);
		// Default importance for import is 0.5
		expect(entity.importance).toBe(0.5);
	});

	// ---------------------------------------------------------------
	// reports errors for malformed files
	// ---------------------------------------------------------------

	it("reports errors for malformed files", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("md-import-malformed", tmpDir);

		const vaultDir = join(tmpDir, "vault");

		// Create a valid file to ensure the import works overall
		writeMd(
			vaultDir,
			"decisions/good-file.md",
			[
				"---",
				"kind: Decision",
				"trust_tier: 2",
				"tags: []",
				"importance: 0.8",
				"---",
				"",
				"# Good Decision",
				"",
				"This is a properly formatted file.",
			].join("\n"),
		);

		// Create a file with only frontmatter delimiters but broken YAML
		// (this should still be imported with best-effort parsing)
		writeMd(
			vaultDir,
			"decisions/partial-frontmatter.md",
			[
				"---",
				"kind: Decision",
				"tags: [broken",
				"---",
				"",
				"# Partial Frontmatter",
				"",
				"File with incomplete YAML tags array.",
			].join("\n"),
		);

		const result = await importFromMarkdown(db, vaultDir);

		// Both files should be imported (best-effort for broken YAML)
		expect(result.entitiesImported).toBe(2);

		// Verify the good file imported correctly
		const { rows } = await db.execute("SELECT * FROM graph_nodes WHERE name = 'Good Decision'");
		expect(rows).toHaveLength(1);
	});
});
