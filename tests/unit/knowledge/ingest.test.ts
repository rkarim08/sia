import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { ingestDocument, parseFrontmatter, parseMarkdown } from "@/knowledge/ingest";

describe("documentation chunking and graph ingestion", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-ingest-test-${randomUUID()}`);
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
	// parseMarkdown splits by headings
	// ---------------------------------------------------------------

	it("parseMarkdown splits by headings", () => {
		const md = [
			"# Getting Started",
			"Introduction text.",
			"",
			"## Installation",
			"Run npm install.",
			"",
			"### Prerequisites",
			"You need Node.js.",
		].join("\n");

		const chunks = parseMarkdown(md);

		expect(chunks).toHaveLength(3);

		expect(chunks[0].heading).toBe("Getting Started");
		expect(chunks[0].headingLevel).toBe(1);
		expect(chunks[0].headingPath).toEqual(["Getting Started"]);

		expect(chunks[1].heading).toBe("Installation");
		expect(chunks[1].headingLevel).toBe(2);
		expect(chunks[1].headingPath).toEqual(["Getting Started", "Installation"]);

		expect(chunks[2].heading).toBe("Prerequisites");
		expect(chunks[2].headingLevel).toBe(3);
		expect(chunks[2].headingPath).toEqual(["Getting Started", "Installation", "Prerequisites"]);
	});

	// ---------------------------------------------------------------
	// parseMarkdown preserves code blocks
	// ---------------------------------------------------------------

	it("parseMarkdown preserves code blocks", () => {
		const md = [
			"# Setup",
			"Here is a code example:",
			"",
			"```js",
			"const x = 1;",
			"# This is not a heading",
			"console.log(x);",
			"```",
			"",
			"End of setup.",
		].join("\n");

		const chunks = parseMarkdown(md);

		// The code fence content should NOT split into a separate heading chunk
		expect(chunks).toHaveLength(1);
		expect(chunks[0].heading).toBe("Setup");
		expect(chunks[0].content).toContain("# This is not a heading");
		expect(chunks[0].codeBlocks).toHaveLength(1);
		expect(chunks[0].codeBlocks[0].language).toBe("js");
		expect(chunks[0].codeBlocks[0].code).toContain("const x = 1;");
		expect(chunks[0].codeBlocks[0].code).toContain("console.log(x);");
	});

	// ---------------------------------------------------------------
	// parseMarkdown extracts internal links
	// ---------------------------------------------------------------

	it("parseMarkdown extracts internal links", () => {
		const md = [
			"# Auth",
			"See [auth module](../auth/README.md) for details.",
			"Check the [JWT section](#jwt-flow) below.",
			"Also see [external](https://example.com/docs).",
		].join("\n");

		const chunks = parseMarkdown(md);

		expect(chunks).toHaveLength(1);
		expect(chunks[0].internalLinks).toHaveLength(2);

		const relativeLink = chunks[0].internalLinks.find((l) => l.target === "../auth/README.md");
		expect(relativeLink).toBeDefined();
		expect(relativeLink?.text).toBe("auth module");
		expect(relativeLink?.isAnchor).toBe(false);

		const anchorLink = chunks[0].internalLinks.find((l) => l.target === "#jwt-flow");
		expect(anchorLink).toBeDefined();
		expect(anchorLink?.text).toBe("JWT section");
		expect(anchorLink?.isAnchor).toBe(true);
	});

	// ---------------------------------------------------------------
	// parseFrontmatter extracts YAML
	// ---------------------------------------------------------------

	it("parseFrontmatter extracts YAML", () => {
		const content = [
			"---",
			"title: Test Document",
			"status: draft",
			"description: A test file for parsing",
			"---",
			"# Body",
			"Content here.",
		].join("\n");

		const { frontmatter, body } = parseFrontmatter(content);

		expect(frontmatter.title).toBe("Test Document");
		expect(frontmatter.status).toBe("draft");
		expect(frontmatter.description).toBe("A test file for parsing");
		expect(body).toContain("# Body");
		expect(body).toContain("Content here.");
		expect(body).not.toContain("---");
	});

	// ---------------------------------------------------------------
	// ingestDocument creates FileNode and ContentChunks
	// ---------------------------------------------------------------

	it("ingestDocument creates FileNode and ContentChunks", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ingest-basic", tmpDir);

		const docContent = [
			"# Overview",
			"This is the overview.",
			"",
			"## Setup",
			"How to set up.",
			"",
			"## Usage",
			"How to use.",
		].join("\n");

		const docPath = join(tmpDir, "README.md");
		writeFileSync(docPath, docContent);

		const result = await ingestDocument(db, docPath, "README.md");

		expect(result.fileNodeId).toBeDefined();
		expect(result.chunksCreated).toBe(3);
		expect(result.edgesCreated).toBe(3);

		// Verify the FileNode entity
		const fileNodes = await db.execute(
			"SELECT * FROM graph_nodes WHERE type = 'FileNode' AND id = ?",
			[result.fileNodeId],
		);
		expect(fileNodes.rows).toHaveLength(1);
		expect(fileNodes.rows[0].name).toBe("README.md");
		expect(fileNodes.rows[0].file_paths).toBe(JSON.stringify(["README.md"]));
		expect(fileNodes.rows[0].extraction_method).toBe("document-ingest");

		// Verify ContentChunk entities
		const chunks = await db.execute(
			"SELECT * FROM graph_nodes WHERE type = 'ContentChunk' ORDER BY name",
			[],
		);
		expect(chunks.rows).toHaveLength(3);
		const chunkNames = chunks.rows.map((r) => r.name as string).sort();
		expect(chunkNames).toContain("Overview");
		expect(chunkNames).toContain("Setup");
		expect(chunkNames).toContain("Usage");

		// Verify child_of edges
		const edges = await db.execute(
			"SELECT * FROM graph_edges WHERE type = 'child_of' AND to_id = ?",
			[result.fileNodeId],
		);
		expect(edges.rows).toHaveLength(3);
	});

	// ---------------------------------------------------------------
	// ingestDocument respects tag and trustTier options
	// ---------------------------------------------------------------

	it("ingestDocument respects tag and trustTier options", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ingest-opts", tmpDir);

		const docContent = "# Config\nSome config details.";
		const docPath = join(tmpDir, "CLAUDE.md");
		writeFileSync(docPath, docContent);

		const result = await ingestDocument(db, docPath, "CLAUDE.md", {
			tag: "ai-context",
			trustTier: 1,
		});

		// Verify FileNode has the custom tag and trust tier
		const fileNode = await db.execute("SELECT * FROM graph_nodes WHERE id = ?", [
			result.fileNodeId,
		]);
		expect(fileNode.rows).toHaveLength(1);
		expect(JSON.parse(fileNode.rows[0].tags as string)).toContain("ai-context");
		expect(fileNode.rows[0].trust_tier).toBe(1);

		// Verify ContentChunk also has the custom tag
		const chunks = await db.execute("SELECT * FROM graph_nodes WHERE type = 'ContentChunk'", []);
		expect(chunks.rows).toHaveLength(1);
		const chunkTags = JSON.parse(chunks.rows[0].tags as string) as string[];
		expect(chunkTags).toContain("ai-context");
		expect(chunks.rows[0].trust_tier).toBe(1);
	});

	// ---------------------------------------------------------------
	// ingestDocument handles frontmatter metadata
	// ---------------------------------------------------------------

	it("ingestDocument handles frontmatter metadata", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ingest-frontmatter", tmpDir);

		const docContent = [
			"---",
			"title: Architecture Guide",
			"description: High-level system architecture overview",
			"---",
			"# Architecture",
			"The system uses a layered architecture.",
		].join("\n");

		const docPath = join(tmpDir, "ARCHITECTURE.md");
		writeFileSync(docPath, docContent);

		const result = await ingestDocument(db, docPath, "docs/ARCHITECTURE.md");

		// FileNode content should use the frontmatter description
		const fileNode = await db.execute("SELECT * FROM graph_nodes WHERE id = ?", [
			result.fileNodeId,
		]);
		expect(fileNode.rows).toHaveLength(1);
		expect(fileNode.rows[0].content).toBe("High-level system architecture overview");
		expect(fileNode.rows[0].summary).toBe("Documentation file: docs/ARCHITECTURE.md");

		// The body chunk should not contain frontmatter
		const chunks = await db.execute("SELECT * FROM graph_nodes WHERE type = 'ContentChunk'", []);
		expect(chunks.rows).toHaveLength(1);
		expect(chunks.rows[0].name).toBe("Architecture");
		expect(chunks.rows[0].content as string).not.toContain("---");
		expect(chunks.rows[0].content as string).toContain("layered architecture");
	});

	// ---------------------------------------------------------------
	// parseMarkdown handles content before first heading
	// ---------------------------------------------------------------

	it("parseMarkdown handles content before first heading", () => {
		const md = [
			"This is preamble text.",
			"More preamble.",
			"",
			"# First Heading",
			"Content under heading.",
		].join("\n");

		const chunks = parseMarkdown(md);

		expect(chunks).toHaveLength(2);

		// First chunk: content before any heading
		expect(chunks[0].heading).toBe("");
		expect(chunks[0].headingLevel).toBe(0);
		expect(chunks[0].headingPath).toEqual([]);
		expect(chunks[0].content).toContain("This is preamble text.");
		expect(chunks[0].content).toContain("More preamble.");

		// Second chunk: the heading section
		expect(chunks[1].heading).toBe("First Heading");
		expect(chunks[1].headingLevel).toBe(1);
	});
});
