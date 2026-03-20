import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { dispatchExtraction } from "@/ast/extractors/tier-dispatch";
import { getLanguageForFile } from "@/ast/languages";
import { createIgnoreMatcher, detectPackagePath, toPosixPath } from "@/ast/path-utils";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity, updateEntity } from "@/graph/entities";
import type { SiaConfig } from "@/shared/config";

export interface IndexResult {
	filesProcessed: number;
	entitiesCreated: number;
	cacheHits: number;
	durationMs: number;
}

export interface IndexOptions {
	dryRun?: boolean;
	onProgress?: (progress: IndexResult & { file?: string }) => void;
	repoHash?: string;
}

interface CacheEntry {
	mtimeMs: number;
}

type CacheMap = Record<string, CacheEntry>;

function loadCache(cachePath: string): CacheMap {
	if (!existsSync(cachePath)) return {};
	try {
		const raw = readFileSync(cachePath, "utf-8");
		return JSON.parse(raw) as CacheMap;
	} catch {
		return {};
	}
}

function saveCache(cachePath: string, cache: CacheMap): void {
	writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
}

/** Walk the repository, extract AST facts, and write CodeEntity nodes. */
export async function indexRepository(
	repoRoot: string,
	db: SiaDb,
	config: SiaConfig,
	opts: IndexOptions = {},
): Promise<IndexResult> {
	const start = Date.now();
	const root = resolve(repoRoot);
	const repoHash = opts.repoHash ?? createHash("sha256").update(resolve(repoRoot)).digest("hex");

	const ignoreMatcher = createIgnoreMatcher(root, config.excludePaths ?? []);
	const cacheDir = join(config.astCacheDir, repoHash);
	const cachePath = join(cacheDir, "index-cache.json");
	const cache = loadCache(cachePath);

	let filesProcessed = 0;
	let entitiesCreated = 0;
	let cacheHits = 0;

	const stack: string[] = [root];

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;

		const entries = readdirSync(current, { withFileTypes: true });
		for (const entry of entries) {
			const absPath = join(current, entry.name);
			const isDir = entry.isDirectory();
			const relPath = toPosixPath(relative(root, absPath));

			if (ignoreMatcher.shouldIgnore(absPath, isDir)) {
				continue;
			}

			if (isDir) {
				stack.push(absPath);
				continue;
			}

			const language = getLanguageForFile(absPath);
			if (!language) continue;

			const stat = statSync(absPath);
			filesProcessed += 1;

			const cached = cache[relPath];
			if (cached && cached.mtimeMs === stat.mtimeMs) {
				cacheHits += 1;
				continue;
			}

			const content = readFileSync(absPath, "utf-8");
			const facts = language
				? dispatchExtraction(content, relPath, language.tier, language.specialHandling)
				: [];
			const packagePath = detectPackagePath(relPath);

			for (const fact of facts) {
				if (!opts.dryRun) {
					// Dedup: check for existing active entity with same name in the same file
					const existing = await db.execute(
						`SELECT id FROM graph_nodes
						 WHERE name = ? AND file_paths LIKE ? AND t_valid_until IS NULL AND archived_at IS NULL`,
						[fact.name, `%${relPath}%`],
					);
					if (existing.rows.length > 0) {
						await updateEntity(db, existing.rows[0].id as string, {
							content: fact.content,
							summary: fact.summary,
							tags: JSON.stringify(fact.tags ?? []),
						});
					} else {
						await insertEntity(db, {
							type: fact.type,
							name: fact.name,
							content: fact.content,
							summary: fact.summary,
							tags: JSON.stringify(fact.tags ?? []),
							file_paths: JSON.stringify(fact.file_paths ?? [relPath]),
							trust_tier: fact.trust_tier,
							confidence: fact.confidence,
							package_path: packagePath,
							extraction_method: fact.extraction_method ?? null,
						});
					}
				}
				entitiesCreated += 1;
			}

			if (!opts.dryRun) {
				cache[relPath] = { mtimeMs: stat.mtimeMs };
			}

			opts.onProgress?.({
				filesProcessed,
				entitiesCreated,
				cacheHits,
				durationMs: Date.now() - start,
				file: relPath,
			});
		}
	}

	if (!opts.dryRun) {
		mkdirSync(cacheDir, { recursive: true });
		saveCache(cachePath, cache);
	}

	return {
		filesProcessed,
		entitiesCreated,
		cacheHits,
		durationMs: Date.now() - start,
	};
}
