import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export interface IgnoreMatcher {
	shouldIgnore(absPath: string, isDir: boolean): boolean;
}

export interface GitignoreRule {
	regex: RegExp;
	dirOnly: boolean;
}

/** Normalize a path to posix-style separators for consistent matching. */
export function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function patternToRegExp(pattern: string): RegExp {
	const trimmed = pattern.trim();
	if (!trimmed) return /^$/; // unused

	// First replace ** and * with placeholders, then escape regex chars, then restore
	const GLOBSTAR = "<<GLOBSTAR>>";
	const STAR = "<<STAR>>";
	const withPlaceholders = trimmed.replace(/\*\*/g, GLOBSTAR).replace(/\*/g, STAR);
	const escaped = withPlaceholders.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	const wildcarded = escaped
		.replace(new RegExp(GLOBSTAR.replace(/[<>]/g, "\\$&"), "g"), ".*")
		.replace(new RegExp(STAR.replace(/[<>]/g, "\\$&"), "g"), "[^/]*");

	if (trimmed.startsWith("/")) {
		return new RegExp(`^${wildcarded.slice(1)}(/.*)?$`);
	}

	return new RegExp(`(^|/)${wildcarded}(/.*)?$`);
}

function loadGitignorePatterns(repoRoot: string): {
	ignore: GitignoreRule[];
	negate: GitignoreRule[];
} {
	const gitignorePath = join(repoRoot, ".gitignore");
	if (!existsSync(gitignorePath)) return { ignore: [], negate: [] };

	const lines = readFileSync(gitignorePath, "utf-8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));

	const ignoreRules: GitignoreRule[] = [];
	const negateRules: GitignoreRule[] = [];

	for (const line of lines) {
		if (line.startsWith("!")) {
			const raw = line.slice(1);
			const isDirOnly = raw.endsWith("/");
			const cleanLine = isDirOnly ? raw.slice(0, -1) : raw;
			negateRules.push({ regex: patternToRegExp(cleanLine), dirOnly: isDirOnly });
		} else {
			const isDirOnly = line.endsWith("/");
			const cleanLine = isDirOnly ? line.slice(0, -1) : line;
			ignoreRules.push({ regex: patternToRegExp(cleanLine), dirOnly: isDirOnly });
		}
	}

	return { ignore: ignoreRules, negate: negateRules };
}

/**
 * Build a matcher that applies default ignores, .gitignore rules, and config.excludePaths.
 */
export function createIgnoreMatcher(repoRoot: string, excludePaths: string[] = []): IgnoreMatcher {
	const root = resolve(repoRoot);
	const gitignoreResult = loadGitignorePatterns(root);
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

			// Apply gitignore patterns with negation support
			let gitIgnored = false;
			for (const rule of gitignoreResult.ignore) {
				if (rule.dirOnly && !isDir) continue;
				if (rule.regex.test(rel)) {
					gitIgnored = true;
					break;
				}
			}
			if (gitIgnored) {
				for (const rule of gitignoreResult.negate) {
					if (rule.dirOnly && !isDir) continue;
					if (rule.regex.test(rel)) {
						gitIgnored = false;
						break;
					}
				}
			}
			if (gitIgnored) return true;

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
