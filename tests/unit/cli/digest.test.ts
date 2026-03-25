import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateDigest, renderDigestMarkdown } from "@/cli/commands/digest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("digest", () => {
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
	// generates digest with entities from period
	// ---------------------------------------------------------------

	it("generates digest with entities from period", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("digest-basic", tmpDir);
		const now = Date.now();

		await insertEntity(db, {
			type: "Decision",
			name: "Use Bun runtime",
			content: "Decided to use Bun",
			summary: "Runtime decision",
			created_at: now,
		});

		await insertEntity(db, {
			type: "Bug",
			name: "Memory leak in cache",
			content: "Cache not freed",
			summary: "Cache memory leak",
			created_at: now,
		});

		await insertEntity(db, {
			type: "Concept",
			name: "Bi-temporal model",
			content: "Entities carry 4 timestamps",
			summary: "Temporal model concept",
			created_at: now,
		});

		const digest = await generateDigest(db, { period: "weekly" });

		expect(digest.totalEntities).toBe(3);
		expect(digest.sections).toHaveLength(3);

		const sectionTitles = digest.sections.map((s) => s.title);
		expect(sectionTitles).toContain("Decisions Captured");
		expect(sectionTitles).toContain("Bugs Identified");
		expect(sectionTitles).toContain("Concepts Added");

		for (const section of digest.sections) {
			expect(section.items).toHaveLength(1);
		}
	});

	// ---------------------------------------------------------------
	// excludes entities outside the period
	// ---------------------------------------------------------------

	it("excludes entities outside the period", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("digest-outside", tmpDir);
		const thirtyDaysAgo = Date.now() - 30 * 86_400_000;

		await insertEntity(db, {
			type: "Decision",
			name: "Old decision",
			content: "An old decision",
			summary: "Old",
			created_at: thirtyDaysAgo,
		});

		const digest = await generateDigest(db, { period: "daily" });

		expect(digest.totalEntities).toBe(0);
		expect(digest.sections).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// groups entities by type
	// ---------------------------------------------------------------

	it("groups entities by type", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("digest-grouping", tmpDir);
		const now = Date.now();

		await insertEntity(db, {
			type: "Decision",
			name: "Decision A",
			content: "First decision",
			summary: "Decision A summary",
			created_at: now,
		});

		await insertEntity(db, {
			type: "Decision",
			name: "Decision B",
			content: "Second decision",
			summary: "Decision B summary",
			created_at: now,
		});

		await insertEntity(db, {
			type: "Bug",
			name: "Bug X",
			content: "A bug",
			summary: "Bug X summary",
			created_at: now,
		});

		const digest = await generateDigest(db, { period: "weekly" });

		const decisionsSection = digest.sections.find((s) => s.title === "Decisions Captured");
		const bugsSection = digest.sections.find((s) => s.title === "Bugs Identified");

		expect(decisionsSection).toBeDefined();
		expect(decisionsSection?.items).toHaveLength(2);

		expect(bugsSection).toBeDefined();
		expect(bugsSection?.items).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// respects custom period
	// ---------------------------------------------------------------

	it("respects custom period", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("digest-custom", tmpDir);

		const baseTime = Date.now() - 10 * 86_400_000;
		const windowStart = baseTime - 86_400_000;
		const windowEnd = baseTime + 86_400_000;

		// Inside the window
		await insertEntity(db, {
			type: "Convention",
			name: "Inside window",
			content: "Convention inside window",
			summary: "Inside",
			created_at: baseTime,
		});

		// Before the window
		await insertEntity(db, {
			type: "Convention",
			name: "Before window",
			content: "Convention before window",
			summary: "Before",
			created_at: windowStart - 2 * 86_400_000,
		});

		// After the window
		await insertEntity(db, {
			type: "Convention",
			name: "After window",
			content: "Convention after window",
			summary: "After",
			created_at: windowEnd + 2 * 86_400_000,
		});

		const digest = await generateDigest(db, {
			period: "custom",
			startDate: windowStart,
			endDate: windowEnd,
		});

		expect(digest.totalEntities).toBe(1);
		expect(digest.period).toBe("custom");
		expect(digest.sections).toHaveLength(1);
		expect(digest.sections[0].title).toBe("Conventions Established");
		expect(digest.sections[0].items[0].name).toBe("Inside window");
	});

	// ---------------------------------------------------------------
	// renderDigestMarkdown produces valid markdown
	// ---------------------------------------------------------------

	it("renderDigestMarkdown produces valid markdown", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("digest-markdown", tmpDir);
		const now = Date.now();

		await insertEntity(db, {
			type: "Decision",
			name: "Use TypeScript",
			content: "TypeScript for type safety",
			summary: "Language choice",
			created_at: now,
		});

		await insertEntity(db, {
			type: "Solution",
			name: "WAL mode fix",
			content: "Enable WAL for concurrency",
			summary: "Database concurrency fix",
			created_at: now,
		});

		const digest = await generateDigest(db, { period: "weekly" });
		const md = renderDigestMarkdown(digest);

		expect(md).toContain("# Knowledge Digest — weekly");
		expect(md).toContain("**Period:**");
		expect(md).toContain("**Total new entities:** 2");
		expect(md).toContain("## Decisions Captured (1)");
		expect(md).toContain("## Solutions Found (1)");
		expect(md).toContain("| Name | Summary |");
		expect(md).toContain("|------|---------|");
		expect(md).toContain("| Use TypeScript | Language choice |");
		expect(md).toContain("| WAL mode fix | Database concurrency fix |");
	});

	// ---------------------------------------------------------------
	// handles empty graph
	// ---------------------------------------------------------------

	it("handles empty graph", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("digest-empty", tmpDir);

		const digest = await generateDigest(db, { period: "weekly" });

		expect(digest.totalEntities).toBe(0);
		expect(digest.sections).toHaveLength(0);
		expect(digest.period).toBe("weekly");
	});

	// ---------------------------------------------------------------
	// returns ISO date strings for startDate and endDate
	// ---------------------------------------------------------------

	it("returns ISO date strings for startDate and endDate", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("digest-iso-dates", tmpDir);
		const now = Date.now();

		await insertEntity(db, {
			type: "Decision",
			name: "ISO date test",
			content: "Testing ISO date output",
			summary: "Date format test",
			created_at: now,
		});

		const digest = await generateDigest(db, { period: "weekly" });

		// Should be ISO strings, not numbers
		expect(typeof digest.startDate).toBe("string");
		expect(typeof digest.endDate).toBe("string");

		// Should be valid ISO date strings (round-trip through Date)
		expect(new Date(digest.startDate).toISOString()).toBe(digest.startDate);
		expect(new Date(digest.endDate).toISOString()).toBe(digest.endDate);
	});
});
