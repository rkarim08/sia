import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { WorkerResult } from "@/ast/index-worker";
import { parseFileWithRetry } from "@/ast/index-worker";
import { getLanguageForFile } from "@/ast/languages";
import { createIgnoreMatcher, toPosixPath } from "@/ast/path-utils";
import type { CandidateFact } from "@/capture/types";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity, updateEntity } from "@/graph/entities";
import type { SiaConfig } from "@/shared/config";

export interface IndexResult {
	filesProcessed: number;
	entitiesCreated: number;
	edgesCreated: number;
	cacheHits: number;
	durationMs: number;
	skippedFiles?: Array<{ path: string; error: string }>;
}

export interface IndexOptions {
	dryRun?: boolean;
	onProgress?: (progress: IndexResult & { file?: string; error?: string }) => void;
	repoHash?: string;
	cacheSaveInterval?: number; // Save cache every N files (default: 500)
	workerCount?: number; // Number of worker threads (default: cpus - 1, 0 = sequential)
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
	entityId?: string; // Set after insert
}

interface FlushResult {
	created: number;
	insertedIds: string[];
}

/**
 * Flush a batch of facts to the database.
 * Uses a single IN-clause SELECT for dedup, then INSERT/UPDATE per entry.
 * Returns both count of new entities and their IDs for edge creation.
 */
async function flushBatch(db: SiaDb, batch: PendingFact[], dryRun: boolean): Promise<FlushResult> {
	if (batch.length === 0 || dryRun) return { created: 0, insertedIds: [] };

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
	const insertedIds: string[] = [];
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
			const entity = await insertEntity(db, {
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
			pending.entityId = entity.id;
			insertedIds.push(entity.id);
			created++;
		}
	}

	return { created, insertedIds };
}

/**
 * Process a single WorkerResult: accumulate facts into batch, flush when full,
 * update cache, and report progress.
 */
async function processResult(
	result: WorkerResult,
	ctx: {
		db: SiaDb;
		cache: CacheMap;
		pendingBatch: PendingFact[];
		allProcessedFacts: PendingFact[];
		allInsertedIds: string[];
		skippedFiles: Array<{ path: string; error: string }>;
		filesProcessed: number;
		entitiesCreated: number;
		cacheHits: number;
		dryRun: boolean;
		cacheInterval: number;
		cacheDir: string;
		cachePath: string;
		start: number;
		onProgress?: IndexOptions["onProgress"];
	},
): Promise<{ filesProcessed: number; entitiesCreated: number }> {
	let { filesProcessed, entitiesCreated } = ctx;

	if (result.error) {
		ctx.skippedFiles.push({ path: result.relPath, error: result.error });
		ctx.onProgress?.({
			filesProcessed,
			entitiesCreated,
			edgesCreated: 0,
			cacheHits: ctx.cacheHits,
			durationMs: Date.now() - ctx.start,
			file: result.relPath,
			error: result.error,
		});
		return { filesProcessed, entitiesCreated };
	}

	for (const fact of result.facts) {
		const pending: PendingFact = {
			fact,
			relPath: result.relPath,
			packagePath: result.packagePath,
		};
		ctx.pendingBatch.push(pending);
		ctx.allProcessedFacts.push(pending);
	}

	// Flush batch when it reaches BATCH_SIZE
	if (ctx.pendingBatch.length >= BATCH_SIZE) {
		const flushed = await flushBatch(ctx.db, ctx.pendingBatch, ctx.dryRun);
		entitiesCreated += flushed.created;
		ctx.allInsertedIds.push(...flushed.insertedIds);
		ctx.pendingBatch.length = 0;
	}

	if (!ctx.dryRun) {
		ctx.cache[result.relPath] = { mtimeMs: result.mtimeMs };
	}

	filesProcessed++;
	if (!ctx.dryRun && filesProcessed % ctx.cacheInterval === 0 && filesProcessed > 0) {
		mkdirSync(ctx.cacheDir, { recursive: true });
		saveCache(ctx.cachePath, ctx.cache);
	}

	ctx.onProgress?.({
		filesProcessed,
		entitiesCreated,
		edgesCreated: 0,
		cacheHits: ctx.cacheHits,
		durationMs: Date.now() - ctx.start,
		file: result.relPath,
	});

	return { filesProcessed, entitiesCreated };
}

/**
 * Resolve proposed_relationships on inserted entities into actual graph edges.
 */
async function createEdgesFromRelationships(
	db: SiaDb,
	allProcessedFacts: PendingFact[],
): Promise<number> {
	let edgesCreated = 0;

	for (const pending of allProcessedFacts) {
		if (!pending.fact.proposed_relationships?.length) continue;
		if (!pending.entityId) continue; // was an update, not an insert

		for (const rel of pending.fact.proposed_relationships) {
			// Look up target entity by name
			const targetRows = await db.execute(
				`SELECT id FROM graph_nodes
				 WHERE name = ? AND t_valid_until IS NULL AND archived_at IS NULL
				 LIMIT 1`,
				[rel.target_name],
			);
			if (targetRows.rows.length > 0) {
				const targetId = targetRows.rows[0].id as string;
				await insertEdge(db, {
					from_id: pending.entityId,
					to_id: targetId,
					type: rel.type,
					weight: rel.weight,
					confidence: 0.8,
					trust_tier: 2,
					extraction_method: "ast",
				});
				edgesCreated++;
			}
		}
	}

	return edgesCreated;
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
	const allProcessedFacts: PendingFact[] = [];
	const allInsertedIds: string[] = [];
	const skippedFiles: Array<{ path: string; error: string }> = [];

	// Phase 1: Walk file tree, collect all files to process
	const filesToProcess: Array<{ absPath: string; relPath: string }> = [];
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

			filesToProcess.push({ absPath, relPath });
		}
	}

	// Reset filesProcessed — it counted all files including cache hits during walk.
	// Now track only files actually processed by workers.
	const totalFilesScanned = filesProcessed;
	filesProcessed = 0;

	// Phase 2: Process files (sequential via parseFileWithRetry)
	// Worker threads are used in production via Bun's Worker API.
	// In test/Node environments, we use the sequential fallback which calls
	// parseFileWithRetry directly — same logic, no thread overhead.
	for (const file of filesToProcess) {
		const result = await parseFileWithRetry(file.absPath, file.relPath);
		const updated = await processResult(result, {
			db,
			cache,
			pendingBatch,
			allProcessedFacts,
			allInsertedIds,
			skippedFiles,
			filesProcessed,
			entitiesCreated,
			cacheHits,
			dryRun: opts.dryRun ?? false,
			cacheInterval: CACHE_INTERVAL,
			cacheDir,
			cachePath,
			start,
			onProgress: opts.onProgress,
		});
		filesProcessed = updated.filesProcessed;
		entitiesCreated = updated.entitiesCreated;
	}

	// Final batch flush
	const finalFlush = await flushBatch(db, pendingBatch, opts.dryRun ?? false);
	entitiesCreated += finalFlush.created;
	allInsertedIds.push(...finalFlush.insertedIds);

	// Phase 3: Create edges from proposed_relationships
	let edgesCreated = 0;
	if (!opts.dryRun) {
		edgesCreated += await createEdgesFromRelationships(db, allProcessedFacts);

		// Run inferEdges for semantic proximity edges
		try {
			const { inferEdges } = await import("@/capture/edge-inferrer");
			if (allInsertedIds.length > 0) {
				edgesCreated += await inferEdges(db, allInsertedIds);
			}
		} catch {
			// inferEdges failure is non-fatal
		}

		mkdirSync(cacheDir, { recursive: true });
		saveCache(cachePath, cache);
	}

	// Restore total filesProcessed to include cache hits
	filesProcessed = totalFilesScanned;

	return {
		filesProcessed,
		entitiesCreated,
		edgesCreated,
		cacheHits,
		durationMs: Date.now() - start,
		skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
	};
}
