import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { exportAsMarkdown, slugify } from "@/knowledge/markdown-export";

describe("markdown export", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-md-export-test-${randomUUID()}`);
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
	// exports entities as markdown files
	// ---------------------------------------------------------------

	it("exports entities as markdown files", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("md-export-basic", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "Use JWT RS256",
			content: "We decided to use RS256 for JWT signing.",
			summary: "JWT RS256 decision",
			importance: 0.8,
		});

		await insertEntity(db, {
			type: "Decision",
			name: "Use PostgreSQL",
			content: "PostgreSQL is our primary data store.",
			summary: "PostgreSQL decision",
			importance: 0.7,
		});

		const outputDir = join(tmpDir, "vault");
		const result = await exportAsMarkdown(db, { outputDir });

		expect(result.entitiesExported).toBe(2);
		// 2 entity files + 1 index.md
		expect(result.filesWritten).toBe(3);
		expect(result.outputDir).toBe(outputDir);

		// Verify files exist in decisions/ directory
		expect(existsSync(join(outputDir, "decisions", "use-jwt-rs256.md"))).toBe(true);
		expect(existsSync(join(outputDir, "decisions", "use-postgresql.md"))).toBe(true);
	});

	// ---------------------------------------------------------------
	// generates valid YAML frontmatter
	// ---------------------------------------------------------------

	it("generates valid YAML frontmatter", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("md-export-frontmatter", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "Use JWT RS256",
			content: "We decided to use RS256 for JWT signing.",
			summary: "JWT RS256 decision",
			tags: '["auth", "security"]',
			trust_tier: 2,
			importance: 0.9,
		});

		const outputDir = join(tmpDir, "vault");
		await exportAsMarkdown(db, { outputDir });

		const filePath = join(outputDir, "decisions", "use-jwt-rs256.md");
		const content = readFileSync(filePath, "utf-8");

		// Verify frontmatter structure
		expect(content.startsWith("---\n")).toBe(true);
		expect(content).toContain("kind: Decision");
		expect(content).toContain("trust_tier: 2");
		expect(content).toContain("importance: 0.9");
		expect(content).toContain("tags: [auth, security]");
		expect(content).toContain("id:");

		// Verify heading
		expect(content).toContain("# Use JWT RS256");

		// Verify body content
		expect(content).toContain("We decided to use RS256 for JWT signing.");
	});

	// ---------------------------------------------------------------
	// includes related entities as wikilinks
	// ---------------------------------------------------------------

	it("includes related entities as wikilinks", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("md-export-wikilinks", tmpDir);

		const decision = await insertEntity(db, {
			type: "Decision",
			name: "Use JWT RS256",
			content: "We decided to use RS256 for JWT signing.",
			summary: "JWT RS256 decision",
		});

		const concept = await insertEntity(db, {
			type: "Concept",
			name: "Authentication Flow",
			content: "The authentication flow uses JWT tokens.",
			summary: "Auth flow concept",
		});

		await insertEdge(db, {
			from_id: decision.id,
			to_id: concept.id,
			type: "pertains_to",
		});

		const outputDir = join(tmpDir, "vault");
		await exportAsMarkdown(db, { outputDir });

		const filePath = join(outputDir, "decisions", "use-jwt-rs256.md");
		const content = readFileSync(filePath, "utf-8");

		expect(content).toContain("## Related");
		expect(content).toContain("pertains_to: [[concepts/authentication-flow]]");
	});

	// ---------------------------------------------------------------
	// creates index.md with summary
	// ---------------------------------------------------------------

	it("creates index.md with summary", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("md-export-index", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "Decision One",
			content: "First decision",
			summary: "Decision one",
		});

		await insertEntity(db, {
			type: "Bug",
			name: "Bug One",
			content: "First bug",
			summary: "Bug one",
		});

		await insertEntity(db, {
			type: "Bug",
			name: "Bug Two",
			content: "Second bug",
			summary: "Bug two",
		});

		const outputDir = join(tmpDir, "vault");
		await exportAsMarkdown(db, { outputDir });

		const indexPath = join(outputDir, "index.md");
		expect(existsSync(indexPath)).toBe(true);

		const content = readFileSync(indexPath, "utf-8");
		expect(content).toContain("# Sia Knowledge Graph Export");
		expect(content).toContain("**Entities:** 3");
		expect(content).toContain("| Decision | 1 |");
		expect(content).toContain("| Bug | 2 |");
	});

	// ---------------------------------------------------------------
	// slugify creates valid filenames
	// ---------------------------------------------------------------

	it("slugify creates valid filenames", () => {
		expect(slugify("Use JWT RS256")).toBe("use-jwt-rs256");
		expect(slugify("Hello World")).toBe("hello-world");
		expect(slugify("CamelCase Name")).toBe("camelcase-name");
		expect(slugify("dots.and/slashes")).toBe("dotsandslashes");
		expect(slugify("  leading  spaces  ")).toBe("leading-spaces");
		expect(slugify("special!@#chars$%^")).toBe("specialchars");
		expect(slugify("multiple---hyphens")).toBe("multiple-hyphens");
		expect(slugify("under_score_name")).toBe("under-score-name");
	});

	// ---------------------------------------------------------------
	// filters by type when specified
	// ---------------------------------------------------------------

	it("filters by type when specified", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("md-export-filter", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "A Decision",
			content: "Decision content",
			summary: "Decision summary",
		});

		await insertEntity(db, {
			type: "Bug",
			name: "A Bug",
			content: "Bug content",
			summary: "Bug summary",
		});

		const outputDir = join(tmpDir, "vault");
		const result = await exportAsMarkdown(db, {
			outputDir,
			types: ["Decision"],
		});

		expect(result.entitiesExported).toBe(1);

		// Decision file should exist
		expect(existsSync(join(outputDir, "decisions", "a-decision.md"))).toBe(true);

		// Bug directory may exist (created for structure) but should have no files
		const bugDir = join(outputDir, "bugs");
		// bugs/ dir should NOT exist since Bug wasn't in the types list
		expect(existsSync(bugDir)).toBe(false);
	});
});
