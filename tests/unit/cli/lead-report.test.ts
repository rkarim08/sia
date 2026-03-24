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

describe("sia lead-report", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) await db.close();
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("drift report", () => {
		it("should list decisions and conventions with file references", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("lead-drift-test", tmpDir);

			await insertEntity(db, {
				type: "Decision",
				name: "All DB access through SiaDb",
				content: "All database access must go through SiaDb interface",
				summary: "DB access convention",
				file_paths: JSON.stringify(["src/graph/db-interface.ts"]),
			});
			await insertEntity(db, {
				type: "Convention",
				name: "Error handlers return JSON",
				content: "All error handlers must return structured JSON",
				summary: "Error handling convention",
				file_paths: JSON.stringify(["src/api/errors.ts"]),
			});

			const { generateLeadReport } = await import("@/cli/commands/lead-report");
			const report = await generateLeadReport(db, { type: "drift" });

			expect(report.type).toBe("drift");
			if (report.type !== "drift") throw new Error("unreachable");
			expect(report.decisions.length).toBe(1);
			expect(report.decisions[0].name).toBe("All DB access through SiaDb");
			expect(report.conventions.length).toBe(1);
			expect(report.conventions[0].name).toBe("Error handlers return JSON");
		});

		it("should exclude archived entities from drift report", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("lead-drift-archived-test", tmpDir);

			await insertEntity(db, {
				type: "Decision",
				name: "Active Decision",
				content: "active",
				summary: "active",
			});
			const archived = await insertEntity(db, {
				type: "Decision",
				name: "Archived Decision",
				content: "archived",
				summary: "archived",
			});
			const { archiveEntity } = await import("@/graph/entities");
			await archiveEntity(db, archived.id);

			const { generateLeadReport } = await import("@/cli/commands/lead-report");
			const report = await generateLeadReport(db, { type: "drift" });

			expect(report.type).toBe("drift");
			if (report.type !== "drift") throw new Error("unreachable");
			expect(report.decisions.length).toBe(1);
			expect(report.decisions[0].name).toBe("Active Decision");
		});
	});

	describe("knowledge-map report", () => {
		it("should count entities by type and created_by", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("lead-kmap-test", tmpDir);

			await insertEntity(db, {
				type: "Decision",
				name: "Dec 1",
				content: "d",
				summary: "d",
				created_by: "alice",
			});
			await insertEntity(db, {
				type: "Decision",
				name: "Dec 2",
				content: "d",
				summary: "d",
				created_by: "alice",
			});
			await insertEntity(db, {
				type: "Convention",
				name: "Conv 1",
				content: "c",
				summary: "c",
				created_by: "bob",
			});
			await insertEntity(db, {
				type: "Bug",
				name: "Bug 1",
				content: "b",
				summary: "b",
				created_by: "alice",
			});

			const { generateLeadReport } = await import("@/cli/commands/lead-report");
			const report = await generateLeadReport(db, { type: "knowledge-map" });

			expect(report.type).toBe("knowledge-map");
			if (report.type !== "knowledge-map") throw new Error("unreachable");
			expect(report.totalEntities).toBe(4);
			expect(report.byType.Decision).toBe(2);
			expect(report.byType.Convention).toBe(1);
			expect(report.byType.Bug).toBe(1);
			expect(report.byContributor.alice).toBe(3);
			expect(report.byContributor.bob).toBe(1);
		});

		it("should identify bus-factor risks", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("lead-kmap-bus-test", tmpDir);

			// All entities from one person = bus factor risk
			for (let i = 0; i < 5; i++) {
				await insertEntity(db, {
					type: "Decision",
					name: `Dec ${i}`,
					content: "d",
					summary: "d",
					created_by: "alice",
				});
			}

			const { generateLeadReport } = await import("@/cli/commands/lead-report");
			const report = await generateLeadReport(db, { type: "knowledge-map" });

			expect(report.type).toBe("knowledge-map");
			if (report.type !== "knowledge-map") throw new Error("unreachable");
			expect(report.byContributor.alice).toBe(5);
			expect(Object.keys(report.byContributor).length).toBe(1);
		});
	});

	describe("compliance report", () => {
		it("should list conventions with entity counts", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("lead-compliance-test", tmpDir);

			await insertEntity(db, {
				type: "Convention",
				name: "Use SiaDb for all DB access",
				content: "All database access must go through SiaDb",
				summary: "DB convention",
				file_paths: JSON.stringify(["src/graph/db-interface.ts"]),
			});
			await insertEntity(db, {
				type: "Convention",
				name: "Tests use temp dirs",
				content: "All tests must use temporary directories",
				summary: "Test convention",
			});

			const { generateLeadReport } = await import("@/cli/commands/lead-report");
			const report = await generateLeadReport(db, { type: "compliance" });

			expect(report.type).toBe("compliance");
			if (report.type !== "compliance") throw new Error("unreachable");
			expect(report.conventions.length).toBe(2);
			expect(report.conventions[0]).toHaveProperty("name");
			expect(report.conventions[0]).toHaveProperty("filePaths");
		});
	});

	describe("formatLeadReport", () => {
		it("should format drift report as human-readable string", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("lead-format-test", tmpDir);

			await insertEntity(db, {
				type: "Decision",
				name: "Use REST not GraphQL",
				content: "We chose REST for simplicity",
				summary: "API decision",
				file_paths: JSON.stringify(["src/api/routes.ts"]),
			});

			const { generateLeadReport, formatLeadReport } = await import("@/cli/commands/lead-report");
			const report = await generateLeadReport(db, { type: "drift" });
			const output = formatLeadReport(report);

			expect(output).toContain("Architecture Drift Report");
			expect(output).toContain("Use REST not GraphQL");
		});

		it("should format knowledge-map report", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("lead-format-kmap-test", tmpDir);

			await insertEntity(db, {
				type: "Decision",
				name: "Dec 1",
				content: "d",
				summary: "d",
				created_by: "alice",
			});

			const { generateLeadReport, formatLeadReport } = await import("@/cli/commands/lead-report");
			const report = await generateLeadReport(db, { type: "knowledge-map" });
			const output = formatLeadReport(report);

			expect(output).toContain("Knowledge Distribution Map");
			expect(output).toContain("alice");
		});

		it("should format compliance report", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("lead-format-compliance-test", tmpDir);

			await insertEntity(db, {
				type: "Convention",
				name: "Error JSON convention",
				content: "Errors return JSON",
				summary: "errors",
			});

			const { generateLeadReport, formatLeadReport } = await import("@/cli/commands/lead-report");
			const report = await generateLeadReport(db, { type: "compliance" });
			const output = formatLeadReport(report);

			expect(output).toContain("Convention Compliance");
			expect(output).toContain("Error JSON convention");
		});
	});
});
