// Module: discovery — Priority-ordered documentation file scanner

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { DISCOVERY_PATTERNS, type DiscoveryPattern, EXCLUDED_DIRS } from "@/knowledge/patterns";

export interface DiscoveredFile {
	absolutePath: string;
	relativePath: string;
	pattern: DiscoveryPattern;
	packagePath: string | null;
}

/** Manifest files that indicate a package root. */
const PACKAGE_MANIFESTS = ["package.json", "Cargo.toml", "go.mod", "pyproject.toml"];

/**
 * Discover documentation files in a repository root.
 * Returns files sorted by priority (1 = highest).
 * Excludes files in EXCLUDED_DIRS and respects .gitignore conceptually
 * (by excluding common non-project directories).
 *
 * Also scans sub-package directories (detected by manifest files) so that
 * monorepo packages have their documentation discovered automatically.
 */
export function discoverDocFiles(repoRoot: string): DiscoveredFile[] {
	const seen = new Set<string>();
	const results: DiscoveredFile[] = [];

	const addMatches = (baseDir: string): void => {
		for (const pattern of DISCOVERY_PATTERNS) {
			const matches = resolvePattern(repoRoot, baseDir, pattern);
			for (const file of matches) {
				if (!seen.has(file.absolutePath)) {
					seen.add(file.absolutePath);
					results.push(file);
				}
			}
		}
	};

	// Scan repo root
	addMatches(repoRoot);

	// Scan sub-package directories for additional documentation
	const subPackages = findSubPackageDirs(repoRoot);
	for (const pkgDir of subPackages) {
		addMatches(pkgDir);
	}

	results.sort((a, b) => a.pattern.priority - b.pattern.priority);
	return results;
}

/**
 * Scan a specific subdirectory for documentation files.
 * Used for JIT discovery when the agent accesses files in a new directory.
 */
export function discoverDocFilesInDir(repoRoot: string, subDir: string): DiscoveredFile[] {
	const absSubDir = resolve(repoRoot, subDir);
	const seen = new Set<string>();
	const results: DiscoveredFile[] = [];

	for (const pattern of DISCOVERY_PATTERNS) {
		const matches = resolvePattern(repoRoot, absSubDir, pattern);
		for (const file of matches) {
			if (!seen.has(file.absolutePath)) {
				seen.add(file.absolutePath);
				results.push(file);
			}
		}
	}

	results.sort((a, b) => a.pattern.priority - b.pattern.priority);
	return results;
}

/**
 * Recursively find directories containing package manifests within the repo,
 * excluding the repo root itself and excluded directories.
 * Limited to a reasonable depth (4 levels) to avoid deep traversals.
 */
function findSubPackageDirs(repoRoot: string, maxDepth = 4): string[] {
	const absRoot = resolve(repoRoot);
	const dirs: string[] = [];

	function walk(dir: string, depth: number): void {
		if (depth > maxDepth) return;

		let entries: import("node:fs").Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true }) as import("node:fs").Dirent[];
		} catch {
			return;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (EXCLUDED_DIRS.has(entry.name as string)) continue;

			const subDir = join(dir, entry.name as string);

			// Check if this directory has a package manifest
			const hasManifest = PACKAGE_MANIFESTS.some((m) => existsSync(join(subDir, m)));
			if (hasManifest && subDir !== absRoot) {
				dirs.push(subDir);
			}

			// Continue walking regardless of manifest presence
			walk(subDir, depth + 1);
		}
	}

	walk(absRoot, 1);
	return dirs;
}

/**
 * Walk up from file's directory to repoRoot, looking for package manifest files.
 * If found at a directory OTHER than repoRoot, returns the relative path of that
 * directory. Returns null if file is at root level.
 */
function detectPackagePath(filePath: string, repoRoot: string): string | null {
	const absRoot = resolve(repoRoot);
	let current = resolve(dirname(filePath));

	while (current.length >= absRoot.length) {
		// Skip the repo root itself — we only want sub-packages
		if (current === absRoot) {
			break;
		}

		for (const manifest of PACKAGE_MANIFESTS) {
			if (existsSync(join(current, manifest))) {
				return relative(absRoot, current);
			}
		}

		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return null;
}

/**
 * Check whether any path segment in a relative path is an excluded directory.
 */
function isExcludedPath(relativePath: string): boolean {
	const segments = relativePath.split("/");
	return segments.some((seg) => EXCLUDED_DIRS.has(seg));
}

/**
 * Resolve a single DiscoveryPattern against a base directory, returning
 * all matching DiscoveredFile entries.
 *
 * Handles two kinds of patterns:
 * - Direct file paths (no wildcards): e.g. "AGENTS.md", ".claude/CLAUDE.md"
 * - Single-star globs: e.g. "docs/adr/*.md", ".cursor/rules/*.mdc"
 */
function resolvePattern(
	repoRoot: string,
	baseDir: string,
	pattern: DiscoveryPattern,
): DiscoveredFile[] {
	const results: DiscoveredFile[] = [];
	const absRoot = resolve(repoRoot);

	if (!pattern.glob.includes("*")) {
		// Direct file — check existence
		const absPath = resolve(baseDir, pattern.glob);
		if (existsSync(absPath) && isFile(absPath)) {
			const relPath = relative(absRoot, absPath);
			if (!isExcludedPath(relPath)) {
				results.push({
					absolutePath: absPath,
					relativePath: relPath,
					pattern,
					packagePath: detectPackagePath(absPath, repoRoot),
				});
			}
		}
	} else {
		// Glob with wildcard — split into directory part and file filter
		const starIdx = pattern.glob.indexOf("*");
		const dirPart = pattern.glob.slice(0, starIdx);
		const suffix = pattern.glob.slice(starIdx + 1);

		// The directory containing the wildcard
		const searchDir = resolve(baseDir, dirPart);

		if (existsSync(searchDir) && isDirectory(searchDir)) {
			let entries: import("node:fs").Dirent[];
			try {
				entries = readdirSync(searchDir, { withFileTypes: true }) as import("node:fs").Dirent[];
			} catch {
				return results;
			}

			for (const entry of entries) {
				if (!entry.isFile()) continue;
				if (!(entry.name as string).endsWith(suffix)) continue;

				const absPath = join(searchDir, entry.name as string);
				const relPath = relative(absRoot, absPath);

				if (!isExcludedPath(relPath)) {
					results.push({
						absolutePath: absPath,
						relativePath: relPath,
						pattern,
						packagePath: detectPackagePath(absPath, repoRoot),
					});
				}
			}
		}
	}

	return results;
}

function isFile(p: string): boolean {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

function isDirectory(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}
