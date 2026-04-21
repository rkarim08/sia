// Module: infer-package-path — unit tests for inferPackagePath helper (Task 14.5)

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inferPackagePath } from "@/capture/pipeline";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-pkg-path-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Normalize any relative path to use forward slashes for cross-platform assertions. */
function toPosix(p: string): string {
	return p.split(sep).join("/");
}

describe("inferPackagePath", () => {
	let repoRoot: string;

	beforeEach(() => {
		repoRoot = makeTmp();
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
	});

	// -------------------------------------------------------------------
	// Monorepo: file inside a package returns the package path
	// -------------------------------------------------------------------

	it("returns the package-relative path for a file inside a monorepo package", () => {
		// Create packages/core/package.json and a source file within it.
		const pkgDir = join(repoRoot, "packages", "core");
		const srcDir = join(pkgDir, "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "core" }));

		const result = inferPackagePath("packages/core/src/foo.ts", repoRoot);
		expect(toPosix(result)).toBe("packages/core");
	});

	// -------------------------------------------------------------------
	// Root package: single-package repo returns "" when the nearest
	// package.json is at the repo root
	// -------------------------------------------------------------------

	it("returns empty string when the nearest package.json is at the repo root", () => {
		mkdirSync(join(repoRoot, "src"), { recursive: true });
		writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "root" }));

		const result = inferPackagePath("src/index.ts", repoRoot);
		expect(result).toBe("");
	});

	// -------------------------------------------------------------------
	// No package.json anywhere above the file: returns ""
	// -------------------------------------------------------------------

	it("returns empty string when no package.json is found above the file", () => {
		// Intentionally no package.json at any level
		mkdirSync(join(repoRoot, "misc"), { recursive: true });

		const result = inferPackagePath("misc/unpackaged.ts", repoRoot);
		expect(result).toBe("");
	});

	// -------------------------------------------------------------------
	// Nested packages: nearest (innermost) package.json wins
	// -------------------------------------------------------------------

	it("walks up to the nearest (innermost) package.json", () => {
		// Root package.json + inner package.json; file is inside the inner package.
		writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "root" }));
		const innerDir = join(repoRoot, "packages", "inner");
		mkdirSync(join(innerDir, "src"), { recursive: true });
		writeFileSync(join(innerDir, "package.json"), JSON.stringify({ name: "inner" }));

		const result = inferPackagePath("packages/inner/src/x.ts", repoRoot);
		expect(toPosix(result)).toBe("packages/inner");
	});

	// -------------------------------------------------------------------
	// Absolute file paths are accepted as-is
	// -------------------------------------------------------------------

	it("accepts absolute file paths", () => {
		const pkgDir = join(repoRoot, "packages", "util");
		const srcDir = join(pkgDir, "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "util" }));

		const absolutePath = join(srcDir, "helpers.ts");
		const result = inferPackagePath(absolutePath, repoRoot);
		expect(toPosix(result)).toBe("packages/util");
	});
});
