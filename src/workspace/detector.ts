// Module: detector — Monorepo auto-detection and package registration
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { SiaDb } from "@/graph/db-interface";

/**
 * Detect monorepo packages from the repo root.
 * Detection precedence:
 * 1. pnpm-workspace.yaml
 * 2. package.json "workspaces"
 * 3. nx.json + project.json files
 * 4. settings.gradle / settings.gradle.kts
 * Turborepo (turbo.json) is informational only.
 */
export async function detectMonorepoPackages(repoRoot: string): Promise<string[]> {
	// 1. pnpm-workspace.yaml
	const pnpmPath = join(repoRoot, "pnpm-workspace.yaml");
	if (existsSync(pnpmPath)) {
		const content = readFileSync(pnpmPath, "utf-8");
		const patterns = parsePnpmWorkspace(content);
		if (patterns.length > 0) return expandGlobs(repoRoot, patterns);
	}

	// 2. package.json "workspaces"
	const pkgJsonPath = join(repoRoot, "package.json");
	if (existsSync(pkgJsonPath)) {
		try {
			const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
			const workspaces = pkgJson?.workspaces;
			if (workspaces) {
				const patterns = Array.isArray(workspaces) ? workspaces : (workspaces.packages ?? []);
				if (patterns.length > 0) return expandGlobs(repoRoot, patterns as string[]);
			}
		} catch {
			/* ignore malformed package.json */
		}
	}

	// 3. Nx (nx.json + project.json files in subdirs)
	if (existsSync(join(repoRoot, "nx.json"))) {
		return findProjectJsonRoots(repoRoot);
	}

	// 4. Gradle (settings.gradle or settings.gradle.kts)
	for (const name of ["settings.gradle", "settings.gradle.kts"]) {
		const gradlePath = join(repoRoot, name);
		if (existsSync(gradlePath)) {
			const content = readFileSync(gradlePath, "utf-8");
			const includes = parseGradleIncludes(content);
			if (includes.length > 0) return includes;
		}
	}

	// Turborepo: informational only
	if (existsSync(join(repoRoot, "turbo.json"))) {
		console.info(
			"Turborepo project detected; package paths sourced from underlying package manager",
		);
	}

	return [];
}

function parsePnpmWorkspace(content: string): string[] {
	const patterns: string[] = [];
	let inPackages = false;

	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (/^packages:\s*$/.test(trimmed) || trimmed === "packages:") {
			inPackages = true;
			continue;
		}
		if (inPackages) {
			if (trimmed.startsWith("- ")) {
				const pattern = trimmed.slice(2).trim().replace(/^['"]/, "").replace(/['"]$/, "");
				if (pattern) patterns.push(pattern);
			} else if (trimmed && !trimmed.startsWith("#")) {
				break;
			}
		}
	}
	return patterns;
}

function expandGlobs(repoRoot: string, patterns: string[]): string[] {
	const results: string[] = [];
	for (const pattern of patterns) {
		if (pattern.endsWith("/*")) {
			const prefix = pattern.slice(0, -2);
			const parentDir = join(repoRoot, prefix);
			if (existsSync(parentDir)) {
				const entries = readdirSync(parentDir, { withFileTypes: true });
				for (const entry of entries) {
					if (entry.isDirectory()) {
						results.push(`${prefix}/${entry.name}`);
					}
				}
			}
		} else {
			if (existsSync(join(repoRoot, pattern))) {
				results.push(pattern);
			}
		}
	}
	return results.sort();
}

function findProjectJsonRoots(repoRoot: string): string[] {
	const results: string[] = [];
	walkForFile(repoRoot, "project.json", results, repoRoot, 3);
	return results.sort();
}

function walkForFile(
	dir: string,
	filename: string,
	results: string[],
	rootDir: string,
	maxDepth: number,
): void {
	if (maxDepth <= 0) return;
	let entries: ReturnType<typeof readdirSync>;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		if (entry.isDirectory()) {
			const childPath = join(dir, entry.name);
			if (existsSync(join(childPath, filename))) {
				results.push(relative(rootDir, childPath));
			}
			walkForFile(childPath, filename, results, rootDir, maxDepth - 1);
		}
	}
}

function parseGradleIncludes(content: string): string[] {
	const results: string[] = [];
	const includePattern = /include\s*\(?([^\n)]+)\)?/g;
	let lineMatch: RegExpExecArray | null = includePattern.exec(content);
	while (lineMatch !== null) {
		const parts = lineMatch[1].split(",");
		for (const part of parts) {
			const cleaned = part
				.trim()
				.replace(/^\(/, "")
				.replace(/\)$/, "")
				.replace(/^['"]/, "")
				.replace(/['"]$/, "");
			if (cleaned.startsWith(":")) {
				results.push(cleaned.slice(1).replace(/:/g, "/"));
			}
		}
		lineMatch = includePattern.exec(content);
	}
	return [...new Set(results)].sort();
}

/**
 * Register detected monorepo packages in meta.db.
 */
export async function registerMonorepoPackages(
	db: SiaDb,
	rootRepoId: string,
	rootPath: string,
	packagePaths: string[],
): Promise<void> {
	await db.execute("UPDATE repos SET detected_type = 'monorepo_root' WHERE id = ?", [rootRepoId]);

	for (const pkgPath of packagePaths) {
		const fullPath = resolve(rootPath, pkgPath);
		const id = createHash("sha256").update(fullPath).digest("hex");
		const now = Date.now();

		await db.execute(
			`INSERT INTO repos (id, path, name, detected_type, monorepo_root_id, created_at, last_accessed)
       VALUES (?, ?, ?, 'monorepo_package', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         detected_type = 'monorepo_package',
         monorepo_root_id = ?,
         last_accessed = ?`,
			[id, fullPath, pkgPath, rootRepoId, now, now, rootRepoId, now],
		);
	}
}
