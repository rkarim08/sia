import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export interface IgnoreMatcher {
	shouldIgnore(absPath: string, isDir: boolean): boolean;
}

/** Normalize a path to posix-style separators for consistent matching. */
export function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function patternToRegExp(pattern: string): RegExp {
	const trimmed = pattern.trim();
	if (!trimmed) return /^$/; // unused

	const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	const wildcarded = escaped.replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, "[^/]*");

	if (trimmed.startsWith("/")) {
		return new RegExp(`^${wildcarded.slice(1)}(/.*)?$`);
	}

	return new RegExp(`(^|/)${wildcarded}(/.*)?$`);
}

function loadGitignorePatterns(repoRoot: string): RegExp[] {
	const gitignorePath = join(repoRoot, ".gitignore");
	if (!existsSync(gitignorePath)) return [];

	const lines = readFileSync(gitignorePath, "utf-8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));

	return lines.map((line) => patternToRegExp(line));
}

/**
 * Build a matcher that applies default ignores, .gitignore rules, and config.excludePaths.
 */
export function createIgnoreMatcher(repoRoot: string, excludePaths: string[] = []): IgnoreMatcher {
	const root = resolve(repoRoot);
	const gitignorePatterns = loadGitignorePatterns(root);
	const defaultExcludes = [
		"node_modules",
		".git",
		".idea",
		".vscode",
		".sia",
		"dist",
		"build",
		"coverage",
		"out",
		"tmp",
	].map((p) => toPosixPath(p));

	const configuredExcludes = excludePaths.map((p) => toPosixPath(p.replace(/^\/+/, "")));

	function isOutside(rel: string): boolean {
		return rel.startsWith("..");
	}

	return {
		shouldIgnore(absPath: string, isDir: boolean): boolean {
			const rel = toPosixPath(relative(root, resolve(absPath)));
			if (isOutside(rel)) return true;
			if (rel === "" || rel === ".") return false;

			for (const prefix of [...defaultExcludes, ...configuredExcludes]) {
				if (rel === prefix || rel.startsWith(`${prefix}/`)) {
					return true;
				}
			}

			// Apply .gitignore-style patterns (best-effort)
			for (const regex of gitignorePatterns) {
				if (regex.test(rel)) {
					return true;
				}
			}

			// If the pattern ends with a slash, only ignore directories
			for (const line of configuredExcludes) {
				if (line.endsWith("/") && rel.startsWith(line.slice(0, -1)) && isDir) {
					return true;
				}
			}

			return false;
		},
	};
}

/** Best-effort monorepo package detector for paths like packages/foo/src/index.ts */
export function detectPackagePath(relativePath: string): string | null {
	const parts = relativePath.split("/");
	const packagesIdx = parts.indexOf("packages");
	if (packagesIdx !== -1 && packagesIdx + 1 < parts.length) {
		return parts.slice(0, packagesIdx + 2).join("/");
	}
	const appsIdx = parts.indexOf("apps");
	if (appsIdx !== -1 && appsIdx + 1 < parts.length) {
		return parts.slice(0, appsIdx + 2).join("/");
	}
	return null;
}
