// Module: incremental-reindexer — Git-diff-driven selective reindex
//
// Compares stored HEAD against current HEAD, diffs changed files,
// content-hashes each to skip unchanged content, then re-parses
// only files with new content through the existing indexer pipeline.
//
// Security: All git commands use execFileSync (array args, no shell).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parseFileWithRetry } from "@/ast/index-worker";
import { type CacheMap, loadCache, saveCache } from "@/ast/indexer";
import { getLanguageForFile } from "@/ast/languages";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity, updateEntity } from "@/graph/entities";
import type { SiaConfig } from "@/shared/config";

/** Maximum files to reindex inline (blocking). Beyond this, cap and log. */
const MAX_INLINE_BATCH = 200;

export interface IncrementalReindexResult {
	triggered: boolean;
	reason?: string;
	filesChanged: number;
	filesReparsed: number;
	filesSkippedByHash: number;
	errors: string[];
}

/**
 * Compute a truncated SHA-256 content hash (16 hex chars).
 */
export function computeContentHash(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Get list of files changed between two git commits.
 * Returns relative paths (posix-style).
 * Uses execFileSync with array args — no shell injection risk.
 */
export function getChangedFiles(cwd: string, oldHead: string, newHead: string): string[] {
	if (oldHead === newHead) return [];
	try {
		const output = execFileSync("git", ["diff", "--name-only", oldHead, newHead], {
			cwd,
			encoding: "utf-8",
			timeout: 10_000,
		});
		return output.trim().split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * Filter file paths to those with extensions supported by SIA's language config.
 */
export function filterSupportedFiles(files: string[]): string[] {
	return files.filter((f) => {
		const ext = extname(f);
		// getLanguageForFile checks extension via the basename
		return ext && getLanguageForFile(`/dummy${ext}`) !== null;
	});
}

/**
 * Read the stored HEAD commit hash from last_head.txt.
 * Returns null if file doesn't exist or is unreadable.
 */
export function readStoredHead(repoDataDir: string): string | null {
	const headPath = join(repoDataDir, "last_head.txt");
	if (!existsSync(headPath)) return null;
	try {
		return readFileSync(headPath, "utf-8").trim();
	} catch {
		return null;
	}
}

/**
 * Write the current HEAD commit hash to last_head.txt.
 */
export function writeStoredHead(repoDataDir: string, head: string): void {
	if (!existsSync(repoDataDir)) {
		mkdirSync(repoDataDir, { recursive: true });
	}
	writeFileSync(join(repoDataDir, "last_head.txt"), head, "utf-8");
}

/**
 * Get current git HEAD for a repository.
 * Uses execFileSync with array args — no shell injection risk.
 */
export function getCurrentHead(cwd: string): string | null {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd,
			encoding: "utf-8",
			timeout: 5_000,
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Run incremental reindex: diff HEAD, hash changed files, re-parse only
 * those with changed content.
 */
export async function incrementalReindex(
	db: SiaDb,
	cwd: string,
	repoHash: string,
	config: SiaConfig,
	oldHead: string | null,
): Promise<IncrementalReindexResult> {
	const currentHead = getCurrentHead(cwd);
	if (!currentHead) {
		return {
			triggered: false,
			reason: "not a git repo",
			filesChanged: 0,
			filesReparsed: 0,
			filesSkippedByHash: 0,
			errors: [],
		};
	}

	const repoDataDir = join(config.repoDir, repoHash);

	// First run — store HEAD and skip
	if (!oldHead) {
		writeStoredHead(repoDataDir, currentHead);
		return {
			triggered: false,
			reason: "first run — stored HEAD",
			filesChanged: 0,
			filesReparsed: 0,
			filesSkippedByHash: 0,
			errors: [],
		};
	}

	// Same HEAD — nothing to do
	if (oldHead === currentHead) {
		return {
			triggered: false,
			reason: "HEAD unchanged",
			filesChanged: 0,
			filesReparsed: 0,
			filesSkippedByHash: 0,
			errors: [],
		};
	}

	// Get changed files
	let changedFiles = getChangedFiles(cwd, oldHead, currentHead);
	if (changedFiles.length === 0) {
		writeStoredHead(repoDataDir, currentHead);
		return {
			triggered: true,
			reason: "diff empty",
			filesChanged: 0,
			filesReparsed: 0,
			filesSkippedByHash: 0,
			errors: [],
		};
	}

	// Filter to supported extensions
	changedFiles = filterSupportedFiles(changedFiles);
	if (changedFiles.length === 0) {
		writeStoredHead(repoDataDir, currentHead);
		return {
			triggered: true,
			reason: "no supported files in diff",
			filesChanged: 0,
			filesReparsed: 0,
			filesSkippedByHash: 0,
			errors: [],
		};
	}

	// Cap at MAX_INLINE_BATCH
	const totalChanged = changedFiles.length;
	const capped = changedFiles.length > MAX_INLINE_BATCH;
	if (capped) {
		changedFiles = changedFiles.slice(0, MAX_INLINE_BATCH);
	}

	// Load cache
	const cacheDir = join(config.astCacheDir, repoHash);
	if (!existsSync(cacheDir)) {
		mkdirSync(cacheDir, { recursive: true });
	}
	const cachePath = join(cacheDir, "index-cache.json");
	const cache: CacheMap = loadCache(cachePath);

	let filesReparsed = 0;
	let filesSkippedByHash = 0;
	const errors: string[] = [];

	for (const relPath of changedFiles) {
		const absPath = join(cwd, relPath);

		// File was deleted
		if (!existsSync(absPath)) {
			delete cache[relPath];
			continue;
		}

		try {
			const stat = statSync(absPath);
			const cached = cache[relPath];

			// Fast path: mtime unchanged → skip
			if (cached && cached.mtimeMs === stat.mtimeMs) {
				filesSkippedByHash++;
				continue;
			}

			// Read content and check hash
			const content = readFileSync(absPath, "utf-8");
			const hash = computeContentHash(content);

			if (cached?.contentHash === hash) {
				// Content unchanged (branch switch) — update mtime only
				cache[relPath] = { mtimeMs: stat.mtimeMs, contentHash: hash };
				filesSkippedByHash++;
				continue;
			}

			// Content changed — re-parse
			const result = await parseFileWithRetry(absPath, relPath);
			if (result && result.facts) {
				for (const fact of result.facts) {
					const existing = await db.execute(
						"SELECT id FROM graph_nodes WHERE name = ? AND type = ? AND t_valid_until IS NULL AND archived_at IS NULL LIMIT 1",
						[fact.name, fact.type],
					);
					if (existing.rows.length > 0) {
						await updateEntity(db, (existing.rows[0] as Record<string, unknown>).id as string, {
							summary: fact.summary,
							content: fact.content,
						});
					} else {
						await insertEntity(db, {
							...fact,
							tags: JSON.stringify(fact.tags),
							file_paths: JSON.stringify(fact.file_paths),
						});
					}
				}
			}

			cache[relPath] = { mtimeMs: stat.mtimeMs, contentHash: hash };
			filesReparsed++;
		} catch (err) {
			errors.push(`${relPath}: ${err}`);
		}
	}

	// Save cache and update stored HEAD
	saveCache(cachePath, cache);
	writeStoredHead(repoDataDir, currentHead);

	return {
		triggered: true,
		reason: capped ? `capped at ${MAX_INLINE_BATCH}/${totalChanged}` : undefined,
		filesChanged: totalChanged,
		filesReparsed,
		filesSkippedByHash,
		errors,
	};
}
