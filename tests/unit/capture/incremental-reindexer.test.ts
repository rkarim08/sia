import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	computeContentHash,
	filterSupportedFiles,
	getChangedFiles,
} from "@/capture/incremental-reindexer";

describe("incremental-reindexer", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "sia-reindex-test-"));
		execFileSync("git", ["init", "-b", "main"], { cwd: tempDir });
		execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tempDir });
		execFileSync("git", ["config", "user.name", "Test"], { cwd: tempDir });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("getChangedFiles", () => {
		it("returns changed files between two commits", () => {
			writeFileSync(join(tempDir, "a.ts"), "export const a = 1;");
			execFileSync("git", ["add", "."], { cwd: tempDir });
			execFileSync("git", ["commit", "-m", "init"], { cwd: tempDir });
			const oldHead = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: tempDir,
				encoding: "utf-8",
			}).trim();

			writeFileSync(join(tempDir, "b.ts"), "export const b = 2;");
			writeFileSync(join(tempDir, "a.ts"), "export const a = 2;");
			execFileSync("git", ["add", "."], { cwd: tempDir });
			execFileSync("git", ["commit", "-m", "second"], { cwd: tempDir });
			const newHead = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: tempDir,
				encoding: "utf-8",
			}).trim();

			const changed = getChangedFiles(tempDir, oldHead, newHead);
			expect(changed.sort()).toEqual(["a.ts", "b.ts"]);
		});

		it("returns empty array when commits are the same", () => {
			writeFileSync(join(tempDir, "a.ts"), "export const a = 1;");
			execFileSync("git", ["add", "."], { cwd: tempDir });
			execFileSync("git", ["commit", "-m", "init"], { cwd: tempDir });
			const head = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: tempDir,
				encoding: "utf-8",
			}).trim();

			const changed = getChangedFiles(tempDir, head, head);
			expect(changed).toEqual([]);
		});
	});

	describe("filterSupportedFiles", () => {
		it("filters to known extensions", () => {
			const files = ["src/a.ts", "src/b.py", "README.md", "image.png", "data.json"];
			const supported = filterSupportedFiles(files);
			// The exact set depends on the language registry — verify known-supported
			// extensions pass and image.png is excluded.
			expect(supported).toContain("src/a.ts");
			expect(supported).toContain("src/b.py");
			expect(supported).not.toContain("image.png");
		});
	});

	describe("computeContentHash", () => {
		it("returns consistent 16-char hex hash", () => {
			const hash = computeContentHash("hello world");
			expect(hash).toHaveLength(16);
			expect(hash).toMatch(/^[0-9a-f]{16}$/);
			expect(computeContentHash("hello world")).toBe(hash);
		});

		it("returns different hash for different content", () => {
			expect(computeContentHash("a")).not.toBe(computeContentHash("b"));
		});
	});
});
