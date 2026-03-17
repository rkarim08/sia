import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIgnoreMatcher } from "@/ast/path-utils";

describe("path-utils gitignore handling", () => {
	let repoRoot: string;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "sia-pathutils-"));
		mkdirSync(join(repoRoot, ".git"));
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
	});

	it("gitignore negation pattern un-ignores a file", () => {
		writeFileSync(join(repoRoot, ".gitignore"), "*.log\n!important.log\n", "utf-8");
		const matcher = createIgnoreMatcher(repoRoot);

		// other.log should be ignored by *.log
		expect(matcher.shouldIgnore(join(repoRoot, "other.log"), false)).toBe(true);

		// important.log should be un-ignored by !important.log
		expect(matcher.shouldIgnore(join(repoRoot, "important.log"), false)).toBe(false);
	});

	it("directory-only pattern ignores directory but not file", () => {
		writeFileSync(join(repoRoot, ".gitignore"), "logs/\n", "utf-8");
		const matcher = createIgnoreMatcher(repoRoot);

		// "logs" as a directory (isDir=true) should be ignored
		expect(matcher.shouldIgnore(join(repoRoot, "logs"), true)).toBe(true);

		// "logs" as a file (isDir=false) should NOT be ignored
		expect(matcher.shouldIgnore(join(repoRoot, "logs"), false)).toBe(false);
	});
});
