import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { dispatchExtractionAsync } from "@/ast/extractors/tier-dispatch";
import { getLanguageForFile } from "@/ast/languages";
import { createIgnoreMatcher, detectPackagePath, toPosixPath } from "@/ast/path-utils";
import type { CandidateFact } from "@/capture/types";
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
	cacheSaveInterval?: number; // Save cache every N files (default: 500)
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

const BATCH_SIZE = 100;

interface PendingFact {
	fact: CandidateFact;
	relPath: string;
	packagePath: string | null;
}

/**
 * Flush a batch of facts to the database.
 * Uses a single IN-clause SELECT for dedup, then INSERT/UPDATE per entry.
 */
async function flushBatch(db: SiaDb, batch: PendingFact[], dryRun: boolean): Promise<number> {
	if (batch.length === 0 || dryRun) return 0;

	// Batch dedup: single query with IN clause
	const names = batch.map((f) => f.fact.name);
	const placeholders = names.map(() => "?").join(", ");
	const existing = await db.execute(
		`SELECT id, name, file_paths FROM graph_nodes
		 WHERE name IN (${placeholders})
		 AND t_valid_until IS NULL AND archived_at IS NULL`,
		names,
	);

	// Key by name+file_paths composite to handle same-named symbols in different files
	const existingMap = new Map<string, { id: string; file_paths: string }>();
	for (const row of existing.rows) {
		const name = row.name as string;
		const filePaths = (row.file_paths as string) ?? "";
		existingMap.set(`${name}::${filePaths}`, {
			id: row.id as string,
			file_paths: filePaths,
		});
	}

	let created = 0;
	for (const pending of batch) {
		const compositeKey = `${pending.fact.name}::${JSON.stringify(pending.fact.file_paths ?? [pending.relPath])}`;
		// Also check without exact file_paths match — the DB may store differently
		const match =
			existingMap.get(compositeKey) ??
			[...existingMap.entries()].find(
				([key, _v]) =>
					key.startsWith(`${pending.fact.name}::`) && _v.file_paths.includes(pending.relPath),
			)?.[1];

		if (match) {
			await updateEntity(db, match.id, {
				content: pending.fact.content,
				summary: pending.fact.summary,
				tags: JSON.stringify(pending.fact.tags ?? []),
			});
		} else {
			await insertEntity(db, {
				type: pending.fact.type,
				name: pending.fact.name,
				content: pending.fact.content,
				summary: pending.fact.summary,
				tags: JSON.stringify(pending.fact.tags ?? []),
				file_paths: JSON.stringify(pending.fact.file_paths ?? [pending.relPath]),
				trust_tier: pending.fact.trust_tier,
				confidence: pending.fact.confidence,
				package_path: pending.packagePath,
				extraction_method: pending.fact.extraction_method ?? null,
			});
			created++;
		}
	}

	return created;
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

	const CACHE_INTERVAL = opts.cacheSaveInterval ?? 500;
	let filesProcessed = 0;
	let entitiesCreated = 0;
	let cacheHits = 0;
	const pendingBatch: PendingFact[] = [];

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
				? await dispatchExtractionAsync(
						content,
						relPath,
						language.tier,
						language.name,
						language.specialHandling,
					)
				: [];
			const packagePath = detectPackagePath(relPath);

			for (const fact of facts) {
				pendingBatch.push({ fact, relPath, packagePath });
			}

			// Flush batch when it reaches BATCH_SIZE
			if (pendingBatch.length >= BATCH_SIZE) {
				entitiesCreated += await flushBatch(db, pendingBatch, opts.dryRun ?? false);
				pendingBatch.length = 0;
			}

			if (!opts.dryRun) {
				cache[relPath] = { mtimeMs: stat.mtimeMs };
				// Periodic cache save for crash recovery
				if (filesProcessed % CACHE_INTERVAL === 0 && filesProcessed > 0) {
					mkdirSync(cacheDir, { recursive: true });
					saveCache(cachePath, cache);
				}
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

	// Final batch flush
	entitiesCreated += await flushBatch(db, pendingBatch, opts.dryRun ?? false);

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
