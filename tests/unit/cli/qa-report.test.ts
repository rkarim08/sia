import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { insertEntity } from "@/graph/entities";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("sia qa-report", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should generate a QA report with risk levels", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("qa-test", tmpDir);

		await insertEntity(db, { type: "Bug", name: "Payment race condition", content: "Concurrent writes fail", summary: "Race condition in payment processing", trust_tier: 2 });
		await insertEntity(db, { type: "Solution", name: "Add mutex", content: "Fixed with lock", summary: "Mutex lock fix for race condition", trust_tier: 1 });
		await insertEntity(db, { type: "Decision", name: "Use Stripe", content: "Payment provider choice", summary: "Chose Stripe as payment provider", trust_tier: 1 });

		const { generateQaReport } = await import("@/cli/commands/qa-report");
		const report = await generateQaReport(db, { since: Date.now() - 86400000 * 30 });

		expect(report).toContain("QA Report");
		expect(report).toContain("Bug");
	});

	it("should handle empty graph gracefully", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("qa-empty", tmpDir);

		const { generateQaReport } = await import("@/cli/commands/qa-report");
		const report = await generateQaReport(db, { since: Date.now() - 86400000 * 7 });

		expect(report).toContain("QA Report");
		expect(report).toContain("No entities");
	});

	it("should include bug activity section with counts", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("qa-bugs", tmpDir);

		await insertEntity(db, { type: "Bug", name: "Auth timeout", content: "Login times out after 30s", summary: "Auth timeout bug", trust_tier: 2 });
		await insertEntity(db, { type: "Bug", name: "API 500 error", content: "Null pointer in handler", summary: "API null pointer", trust_tier: 2 });
		await insertEntity(db, { type: "Solution", name: "Fix null check", content: "Added null guard", summary: "Null guard fix", trust_tier: 1 });

		const { generateQaReport } = await import("@/cli/commands/qa-report");
		const report = await generateQaReport(db, { since: Date.now() - 86400000 * 30 });

		expect(report).toContain("Bug Activity");
		expect(report).toContain("Auth timeout");
		expect(report).toContain("API 500 error");
	});

	it("should include test recommendations from bug history", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("qa-recs", tmpDir);

		await insertEntity(db, { type: "Bug", name: "Cache invalidation race", content: "Stale cache served after write", summary: "Cache race condition", trust_tier: 2 });

		const { generateQaReport } = await import("@/cli/commands/qa-report");
		const report = await generateQaReport(db, { since: Date.now() - 86400000 * 30 });

		expect(report).toContain("Test Recommendations");
		expect(report).toContain("Cache invalidation race");
	});
});
