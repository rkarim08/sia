import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaDetectChanges, parseGitDiffOutput } from "@/mcp/tools/sia-detect-changes";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-dc-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("sia_detect_changes tool", () => {
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
	// parseGitDiffOutput correctly parses git diff --name-status output
	// ---------------------------------------------------------------

	describe("parseGitDiffOutput", () => {
		it("parses modified, added, and deleted files", () => {
			const output = "M\tsrc/index.ts\nA\tsrc/new-file.ts\nD\tsrc/old-file.ts\n";
			const result = parseGitDiffOutput(output);

			expect(result).toEqual([
				{ path: "src/index.ts", status: "modified" },
				{ path: "src/new-file.ts", status: "added" },
				{ path: "src/old-file.ts", status: "deleted" },
			]);
		});

		it("handles empty output", () => {
			const result = parseGitDiffOutput("");
			expect(result).toEqual([]);
		});

		it("handles rename status (R prefix)", () => {
			const output = "R100\told.ts\tnew.ts\n";
			const result = parseGitDiffOutput(output);
			expect(result.length).toBe(1);
			expect(result[0].status).toBe("modified");
		});
	});

	// ---------------------------------------------------------------
	// Maps changed files to graph entities
	// ---------------------------------------------------------------

	it("maps changed files to graph entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("dc-entities", tmpDir);

		// Insert entities associated with specific files
		await insertEntity(db, {
			type: "CodeEntity",
			name: "AuthModule",
			content: "auth module",
			summary: "Authentication module",
			file_paths: JSON.stringify(["src/auth.ts"]),
		});

		await insertEntity(db, {
			type: "CodeEntity",
			name: "UserService",
			content: "user service",
			summary: "User service",
			file_paths: JSON.stringify(["src/user.ts"]),
		});

		const gitDiffOutput = "M\tsrc/auth.ts\nM\tsrc/user.ts\n";

		const result = await handleSiaDetectChanges(
			db,
			{ scope: "HEAD~1..HEAD" },
			async () => gitDiffOutput,
		);

		expect(result.files_changed.length).toBe(2);
		expect(result.total_entities_affected).toBe(2);

		const authFile = result.files_changed.find((f) => f.path === "src/auth.ts");
		expect(authFile).toBeDefined();
		expect(authFile?.status).toBe("modified");
		expect(authFile?.entities.length).toBe(1);
		expect(authFile?.entities[0].name).toBe("AuthModule");
	});

	// ---------------------------------------------------------------
	// Returns empty when no matching entities
	// ---------------------------------------------------------------

	it("returns files with empty entities when no graph entities match", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("dc-no-match", tmpDir);

		const gitDiffOutput = "M\tsrc/unknown.ts\n";

		const result = await handleSiaDetectChanges(
			db,
			{ scope: "HEAD~1..HEAD" },
			async () => gitDiffOutput,
		);

		expect(result.files_changed.length).toBe(1);
		expect(result.files_changed[0].entities.length).toBe(0);
		expect(result.total_entities_affected).toBe(0);
	});

	// ---------------------------------------------------------------
	// Handles git diff errors gracefully
	// ---------------------------------------------------------------

	it("handles git diff errors gracefully", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("dc-error", tmpDir);

		const result = await handleSiaDetectChanges(db, { scope: "HEAD~1..HEAD" }, async () => {
			throw new Error("git not found");
		});

		expect(result.files_changed.length).toBe(0);
		expect(result.total_entities_affected).toBe(0);
	});

	// ---------------------------------------------------------------
	// next_steps populated when files changed
	// ---------------------------------------------------------------

	it("populates next_steps when files changed", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("dc-next-steps", tmpDir);

		const result = await handleSiaDetectChanges(
			db,
			{ scope: "HEAD~1..HEAD" },
			async () => "M\tsrc/foo.ts\n",
		);
		expect(result.files_changed.length).toBeGreaterThan(0);
		expect(result.next_steps?.length).toBeGreaterThan(0);
		expect(result.next_steps?.map((s) => s.tool)).toContain("sia_impact");
	});

	it("omits next_steps when no files changed", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("dc-no-changes", tmpDir);

		const result = await handleSiaDetectChanges(db, { scope: "HEAD~1..HEAD" }, async () => "");
		expect(result.files_changed.length).toBe(0);
		expect(result.next_steps).toBeUndefined();
	});
});
