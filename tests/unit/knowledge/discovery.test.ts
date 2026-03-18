import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverDocFiles, discoverDocFilesInDir } from "@/knowledge/discovery";

describe("documentation auto-discovery", () => {
	let tmpDir: string;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-discovery-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	function touch(path: string, content = ""): void {
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, content);
	}

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// discovers priority 1 AI context files
	// ---------------------------------------------------------------

	it("discovers priority 1 AI context files", () => {
		tmpDir = makeTmp();
		touch(join(tmpDir, "AGENTS.md"), "# Agents");
		touch(join(tmpDir, "CLAUDE.md"), "# Claude");

		const results = discoverDocFiles(tmpDir);

		expect(results).toHaveLength(2);
		for (const r of results) {
			expect(r.pattern.priority).toBe(1);
			expect(r.pattern.tag).toBe("ai-context");
			expect(r.pattern.trustTier).toBe(1);
		}
		const names = results.map((r) => r.relativePath);
		expect(names).toContain("AGENTS.md");
		expect(names).toContain("CLAUDE.md");
	});

	// ---------------------------------------------------------------
	// discovers priority 2 architecture docs
	// ---------------------------------------------------------------

	it("discovers priority 2 architecture docs", () => {
		tmpDir = makeTmp();
		touch(join(tmpDir, "ARCHITECTURE.md"), "# Architecture");
		mkdirSync(join(tmpDir, "docs", "adr"), { recursive: true });
		touch(join(tmpDir, "docs", "adr", "001.md"), "# ADR 001");

		const results = discoverDocFiles(tmpDir);

		expect(results).toHaveLength(2);
		for (const r of results) {
			expect(r.pattern.priority).toBe(2);
			expect(r.pattern.tag).toBe("architecture");
		}
	});

	// ---------------------------------------------------------------
	// discovers priority 3 project docs
	// ---------------------------------------------------------------

	it("discovers priority 3 project docs", () => {
		tmpDir = makeTmp();
		touch(join(tmpDir, "README.md"), "# Readme");
		touch(join(tmpDir, "CONTRIBUTING.md"), "# Contributing");

		const results = discoverDocFiles(tmpDir);

		expect(results).toHaveLength(2);
		for (const r of results) {
			expect(r.pattern.priority).toBe(3);
			expect(r.pattern.tag).toBe("project-docs");
		}
	});

	// ---------------------------------------------------------------
	// excludes node_modules and .git directories
	// ---------------------------------------------------------------

	it("excludes node_modules and .git directories", () => {
		tmpDir = makeTmp();
		// Create docs inside excluded directories
		mkdirSync(join(tmpDir, "node_modules"), { recursive: true });
		touch(join(tmpDir, "node_modules", "README.md"), "# NM");
		mkdirSync(join(tmpDir, ".git"), { recursive: true });
		touch(join(tmpDir, ".git", "README.md"), "# Git");

		// Also create a valid doc so we know discovery runs
		touch(join(tmpDir, "README.md"), "# Root");

		const results = discoverDocFiles(tmpDir);

		const paths = results.map((r) => r.relativePath);
		expect(paths).not.toContain("node_modules/README.md");
		expect(paths).not.toContain(".git/README.md");
		expect(paths).toContain("README.md");
	});

	// ---------------------------------------------------------------
	// sorts results by priority
	// ---------------------------------------------------------------

	it("sorts results by priority", () => {
		tmpDir = makeTmp();
		// Priority 5
		touch(join(tmpDir, "CHANGELOG.md"), "# Changelog");
		// Priority 1
		touch(join(tmpDir, "AGENTS.md"), "# Agents");
		// Priority 3
		touch(join(tmpDir, "README.md"), "# Readme");
		// Priority 2
		touch(join(tmpDir, "ARCHITECTURE.md"), "# Architecture");
		// Priority 4
		touch(join(tmpDir, "API.md"), "# API");

		const results = discoverDocFiles(tmpDir);

		expect(results.length).toBeGreaterThanOrEqual(5);
		const priorities = results.map((r) => r.pattern.priority);
		for (let i = 1; i < priorities.length; i++) {
			expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1] as number);
		}
	});

	// ---------------------------------------------------------------
	// detects package path in monorepo
	// ---------------------------------------------------------------

	it("detects package path in monorepo", () => {
		tmpDir = makeTmp();
		mkdirSync(join(tmpDir, "packages", "auth"), { recursive: true });
		touch(join(tmpDir, "packages", "auth", "package.json"), "{}");
		touch(join(tmpDir, "packages", "auth", "README.md"), "# Auth");

		// Root README should have null packagePath
		touch(join(tmpDir, "README.md"), "# Root");

		const results = discoverDocFiles(tmpDir);

		const authDoc = results.find((r) => r.relativePath === "packages/auth/README.md");
		expect(authDoc).toBeDefined();
		expect(authDoc?.packagePath).toBe("packages/auth");

		const rootDoc = results.find((r) => r.relativePath === "README.md");
		expect(rootDoc).toBeDefined();
		expect(rootDoc?.packagePath).toBeNull();
	});

	// ---------------------------------------------------------------
	// discoverDocFilesInDir scopes to subdirectory
	// ---------------------------------------------------------------

	it("discoverDocFilesInDir scopes to subdirectory", () => {
		tmpDir = makeTmp();
		// Root-level docs
		touch(join(tmpDir, "README.md"), "# Root");
		touch(join(tmpDir, "AGENTS.md"), "# Agents");

		// Subdirectory docs
		mkdirSync(join(tmpDir, "packages", "auth"), { recursive: true });
		touch(join(tmpDir, "packages", "auth", "package.json"), "{}");
		touch(join(tmpDir, "packages", "auth", "README.md"), "# Auth");
		touch(join(tmpDir, "packages", "auth", "CONTRIBUTING.md"), "# Auth Contributing");

		const results = discoverDocFilesInDir(tmpDir, "packages/auth");

		// Should only find docs within packages/auth
		for (const r of results) {
			expect(r.relativePath.startsWith("packages/auth/")).toBe(true);
		}
		const paths = results.map((r) => r.relativePath);
		expect(paths).toContain("packages/auth/README.md");
		expect(paths).toContain("packages/auth/CONTRIBUTING.md");
		expect(paths).not.toContain("README.md");
		expect(paths).not.toContain("AGENTS.md");
	});
});
