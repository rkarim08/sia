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

// Helper: create a date N days ago (epoch ms)
function daysAgo(n: number): number {
	return Date.now() - n * 24 * 60 * 60 * 1000;
}

describe("sia pm-report — sprint summary", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should generate a sprint summary with all PM sections", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pm-sprint", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "Use Redis for caching",
			content: "Chose Redis over Memcached for richer data structures",
			summary: "Redis decision",
			trust_tier: 1,
			kind: "Decision",
			created_at: daysAgo(5),
		});
		await insertEntity(db, {
			type: "Bug",
			name: "Login timeout on Safari",
			content: "Safari blocks third-party cookies causing session loss",
			summary: "Safari login bug",
			trust_tier: 2,
			kind: "Bug",
			created_at: daysAgo(3),
		});
		await insertEntity(db, {
			type: "Solution",
			name: "Switch to first-party cookies",
			content: "Moved session storage to first-party cookies",
			summary: "Cookie fix",
			trust_tier: 1,
			kind: "Solution",
			created_at: daysAgo(2),
		});
		await insertEntity(db, {
			type: "Convention",
			name: "Error codes enum",
			content: "All API errors must use the ErrorCode enum",
			summary: "Error code convention",
			trust_tier: 1,
			kind: "Convention",
			created_at: daysAgo(1),
		});

		const { generatePmReport } = await import("@/cli/commands/pm-report");
		const markdown = await generatePmReport(db, {
			type: "sprint",
			since: daysAgo(7),
			until: Date.now(),
		});

		expect(markdown).toContain("Sprint Summary");
		expect(markdown).toContain("Key Decisions");
		expect(markdown).toContain("Use Redis for caching");
		expect(markdown).toContain("Bugs");
		expect(markdown).toContain("Login timeout on Safari");
		expect(markdown).toContain("Solutions");
		expect(markdown).toContain("Switch to first-party cookies");
		expect(markdown).toContain("Conventions");
		expect(markdown).toContain("Error codes enum");
	});

	it("should filter entities by time range", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pm-sprint-filter", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "Recent decision",
			content: "Made recently",
			summary: "s",
			trust_tier: 1,
			created_at: daysAgo(2),
		});
		await insertEntity(db, {
			type: "Decision",
			name: "Old decision",
			content: "Made long ago",
			summary: "s",
			trust_tier: 1,
			created_at: daysAgo(30),
		});

		const { generatePmReport } = await import("@/cli/commands/pm-report");
		const markdown = await generatePmReport(db, {
			type: "sprint",
			since: daysAgo(7),
			until: Date.now(),
		});

		expect(markdown).toContain("Recent decision");
		expect(markdown).not.toContain("Old decision");
	});

	it("should handle empty graph gracefully", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pm-sprint-empty", tmpDir);

		const { generatePmReport } = await import("@/cli/commands/pm-report");
		const markdown = await generatePmReport(db, {
			type: "sprint",
			since: daysAgo(14),
			until: Date.now(),
		});

		expect(markdown).toContain("Sprint Summary");
		expect(markdown).toContain("No activity");
	});
});

describe("sia pm-report — decision log", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should generate a chronological decision log", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pm-decisions", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "Adopt TypeScript",
			content: "Migrating from JS to TS for type safety",
			summary: "TS migration",
			trust_tier: 1,
			created_at: daysAgo(10),
		});
		await insertEntity(db, {
			type: "Decision",
			name: "Use Vitest",
			content: "Chose Vitest over Jest for speed",
			summary: "Test framework",
			trust_tier: 1,
			created_at: daysAgo(5),
		});

		const { generatePmReport } = await import("@/cli/commands/pm-report");
		const markdown = await generatePmReport(db, { type: "decisions", since: daysAgo(14) });

		expect(markdown).toContain("Decision Log");
		expect(markdown).toContain("Adopt TypeScript");
		expect(markdown).toContain("Use Vitest");
		// Should be chronological (oldest first)
		const tsIdx = markdown.indexOf("Adopt TypeScript");
		const vitestIdx = markdown.indexOf("Use Vitest");
		expect(tsIdx).toBeLessThan(vitestIdx);
	});

	it("should handle no decisions gracefully", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pm-decisions-empty", tmpDir);

		const { generatePmReport } = await import("@/cli/commands/pm-report");
		const markdown = await generatePmReport(db, { type: "decisions", since: daysAgo(14) });

		expect(markdown).toContain("Decision Log");
		expect(markdown).toContain("No decisions");
	});
});

describe("sia pm-report — risk dashboard", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should generate a risk dashboard with categorized risks", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pm-risks", tmpDir);

		// Recurring bugs in same area = critical risk
		await insertEntity(db, {
			type: "Bug",
			name: "Payment timeout",
			content: "Payments timing out under load",
			summary: "Payment bug 1",
			trust_tier: 2,
			file_paths: '["src/payments/charge.ts"]',
			created_at: daysAgo(5),
		});
		await insertEntity(db, {
			type: "Bug",
			name: "Payment duplicate charge",
			content: "Duplicate charges on retry",
			summary: "Payment bug 2",
			trust_tier: 2,
			file_paths: '["src/payments/charge.ts"]',
			created_at: daysAgo(2),
		});
		// Stale convention = moderate risk
		await insertEntity(db, {
			type: "Convention",
			name: "Use callbacks",
			content: "All async code uses callbacks",
			summary: "Callback convention",
			trust_tier: 1,
			created_at: daysAgo(60),
		});

		const { generatePmReport } = await import("@/cli/commands/pm-report");
		const markdown = await generatePmReport(db, { type: "risks" });

		expect(markdown).toContain("Risk Dashboard");
		expect(markdown).toContain("Payment timeout");
		expect(markdown).toContain("Payment duplicate charge");
	});

	it("should handle no risks gracefully", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pm-risks-empty", tmpDir);

		const { generatePmReport } = await import("@/cli/commands/pm-report");
		const markdown = await generatePmReport(db, { type: "risks" });

		expect(markdown).toContain("Risk Dashboard");
		expect(markdown).toContain("No risks");
	});
});
