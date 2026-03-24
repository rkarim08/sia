import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("sia export-knowledge", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should generate a markdown document with all knowledge categories", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("export-test", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "Use SQLite",
			content: "Chose SQLite for embedded storage",
			summary: "SQLite decision",
			trust_tier: 1,
		});
		await insertEntity(db, {
			type: "Convention",
			name: "Async/await everywhere",
			content: "All DB calls use async/await",
			summary: "Async convention",
			trust_tier: 1,
		});
		await insertEntity(db, {
			type: "Bug",
			name: "Race condition in cache",
			content: "Two threads writing simultaneously",
			summary: "Cache race condition",
			trust_tier: 2,
		});
		await insertEntity(db, {
			type: "Solution",
			name: "Add mutex lock",
			content: "Fixed with a simple lock",
			summary: "Mutex fix",
			trust_tier: 1,
		});
		await insertEntity(db, {
			type: "Concept",
			name: "Bi-temporal model",
			content: "Entities carry 4 timestamps",
			summary: "Temporal model",
			trust_tier: 1,
		});

		const { generateKnowledgeDocument } = await import("@/cli/commands/export-knowledge");
		const markdown = await generateKnowledgeDocument(db, { projectName: "Test Project" });

		expect(markdown).toContain("# Test Project — Knowledge Base");
		expect(markdown).toContain("## Architectural Decisions");
		expect(markdown).toContain("Use SQLite");
		expect(markdown).toContain("## Coding Conventions");
		expect(markdown).toContain("Async/await everywhere");
		expect(markdown).toContain("## Known Issues");
		expect(markdown).toContain("Race condition in cache");
		expect(markdown).toContain("## Solutions");
		expect(markdown).toContain("Add mutex lock");
		expect(markdown).toContain("## Key Concepts");
		expect(markdown).toContain("Bi-temporal model");
	});

	it("should handle empty graph gracefully", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("export-empty", tmpDir);

		const { generateKnowledgeDocument } = await import("@/cli/commands/export-knowledge");
		const markdown = await generateKnowledgeDocument(db, { projectName: "Empty" });

		expect(markdown).toContain("# Empty — Knowledge Base");
		expect(markdown).toContain("No knowledge captured yet");
	});
});
