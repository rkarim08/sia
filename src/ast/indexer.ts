import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, relative, resolve } from "node:path";
import type { WorkerMessage, WorkerResult } from "@/ast/index-worker";
import { parseFileWithRetry } from "@/ast/index-worker";
import { getLanguageForFile } from "@/ast/languages";
import { createIgnoreMatcher, toPosixPath } from "@/ast/path-utils";
import { getCurrentHead, writeStoredHead } from "@/capture/incremental-reindexer";
import type { CandidateFact } from "@/capture/types";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity, updateEntity } from "@/graph/entities";
import type { SiaConfig } from "@/shared/config";

/**
 * Runtime-agnostic handle to a single worker.
 * `raw` holds the underlying runtime-specific worker object.
 */
interface WorkerHandle {
	postMessage(msg: WorkerMessage): void;
	terminate(): void;
	/** The underlying runtime worker (bun Worker or Node Worker). */
	readonly raw: unknown;
}

interface WorkerAdapter {
	create(workerPath: string | URL): WorkerHandle;
	onMessage(worker: WorkerHandle, handler: (result: WorkerResult) => void): void;
	onError(worker: WorkerHandle, handler: (err: Error) => void): void;
}

function getBunAdapter(): WorkerAdapter {
	return {
		create(workerPath: string | URL): WorkerHandle {
			const w = new Worker(workerPath);
			return {
				postMessage: (msg) => w.postMessage(msg),
				terminate: () => w.terminate(),
				raw: w,
			};
		},
		onMessage(worker: WorkerHandle, handler: (result: WorkerResult) => void): void {
			(worker.raw as InstanceType<typeof Worker>).onmessage = (event: MessageEvent) =>
				handler(event.data);
		},
		onError(worker: WorkerHandle, handler: (err: Error) => void): void {
			(worker.raw as InstanceType<typeof Worker>).onerror = (event: ErrorEvent) =>
				handler(new Error(event.message));
		},
	};
}

function getNodeAdapter(): WorkerAdapter {
	const { Worker } = require("node:worker_threads") as typeof import("node:worker_threads");
	type NodeWorker = InstanceType<typeof Worker>;

	return {
		create(workerPath: string | URL): WorkerHandle {
			const w = new Worker(typeof workerPath === "string" ? workerPath : workerPath.pathname);
			return {
				postMessage: (msg) => w.postMessage(msg),
				terminate: () => {
					w.terminate();
				},
				raw: w,
			};
		},
		onMessage(worker: WorkerHandle, handler: (result: WorkerResult) => void): void {
			(worker.raw as NodeWorker).on("message", handler);
		},
		onError(worker: WorkerHandle, handler: (err: Error) => void): void {
			(worker.raw as NodeWorker).on("error", handler);
		},
	};
}

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

export interface CacheEntry {
	mtimeMs: number;
	contentHash?: string; // SHA-256 truncated to 16 hex chars
}

export type CacheMap = Record<string, CacheEntry>;

export function loadCache(cachePath: string): CacheMap {
	if (!existsSync(cachePath)) return {};
	try {
		const raw = readFileSync(cachePath, "utf-8");
		return JSON.parse(raw) as CacheMap;
	} catch {
		return {};
	}
}

export function saveCache(cachePath: string, cache: CacheMap): void {
	writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
}

export function computeContentHash(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

const BATCH_SIZE = 100;

export interface PendingFact {
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
		ctx.cache[result.relPath] = {
			mtimeMs: result.mtimeMs,
			...(result.contentHash ? { contentHash: result.contentHash } : {}),
		};
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
export async function createEdgesFromRelationships(
	db: SiaDb,
	allProcessedFacts: PendingFact[],
): Promise<number> {
	let edgesCreated = 0;

	// Collect all unique target names that need lookup
	const targetNames = new Set<string>();
	for (const pending of allProcessedFacts) {
		if (!pending.fact.proposed_relationships?.length || !pending.entityId) continue;
		for (const rel of pending.fact.proposed_relationships) {
			targetNames.add(rel.target_name);
		}
	}

	if (targetNames.size === 0) return 0;

	// Batch lookup all target names
	const nameList = [...targetNames];
	const nameMap = new Map<string, string>(); // name → id
	for (let i = 0; i < nameList.length; i += 500) {
		const batch = nameList.slice(i, i + 500);
		const placeholders = batch.map(() => "?").join(", ");
		const result = await db.execute(
			`SELECT id, name FROM graph_nodes
			 WHERE name IN (${placeholders})
			   AND t_valid_until IS NULL AND archived_at IS NULL`,
			batch,
		);
		for (const row of result.rows) {
			// First match wins (LIMIT 1 equivalent)
			if (!nameMap.has(row.name as string)) {
				nameMap.set(row.name as string, row.id as string);
			}
		}
	}

	// Create edges using the pre-fetched map
	for (const pending of allProcessedFacts) {
		if (!pending.fact.proposed_relationships?.length || !pending.entityId) continue;
		for (const rel of pending.fact.proposed_relationships) {
			const targetId = nameMap.get(rel.target_name);
			if (targetId && targetId !== pending.entityId) {
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

/**
 * Dispatch files to a pool of workers for parallel parsing.
 * Uses the runtime's native worker API (Bun Web Workers or Node worker_threads).
 * Round-robin with backpressure: each worker gets one file at a time,
 * receives the next when it reports completion.
 */
async function dispatchToWorkerPool(
	filesToProcess: Array<{ absPath: string; relPath: string }>,
	numWorkers: number,
): Promise<WorkerResult[]> {
	const isBun = typeof (globalThis as Record<string, unknown>).Bun !== "undefined";
	const adapter = isBun ? getBunAdapter() : getNodeAdapter();
	const workerUrl = new URL("./index-worker.ts", import.meta.url);
	const workerPath = isBun ? workerUrl : workerUrl.pathname;

	const workers: WorkerHandle[] = [];
	for (let i = 0; i < numWorkers; i++) {
		workers.push(adapter.create(workerPath));
	}

	const results: WorkerResult[] = [];
	let fileIndex = 0;
	const total = filesToProcess.length;

	await new Promise<void>((resolve, reject) => {
		if (total === 0) {
			resolve();
			return;
		}

		let completed = 0;
		for (const worker of workers) {
			adapter.onMessage(worker, (result: WorkerResult) => {
				results.push(result);
				completed++;

				if (fileIndex < total) {
					const msg: WorkerMessage = filesToProcess[fileIndex++];
					worker.postMessage(msg);
				} else if (completed === total) {
					resolve();
				}
			});

			adapter.onError(worker, (err: Error) => {
				reject(err);
			});

			// Seed each worker with initial work
			if (fileIndex < total) {
				const msg: WorkerMessage = filesToProcess[fileIndex++];
				worker.postMessage(msg);
			}
		}
	});

	// Terminate workers
	for (const worker of workers) {
		worker.terminate();
	}

	return results;
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

	// Phase 2: Process files
	// Use native worker pool when there are enough files and workers aren't disabled.
	// Each runtime uses its own worker API (Bun Web Workers / Node worker_threads).
	const numWorkers = opts.workerCount ?? Math.max(1, cpus().length - 1);
	const useWorkers = numWorkers > 0 && filesToProcess.length > 10 && opts.workerCount !== 0;

	let workerResults: WorkerResult[] | null = null;
	if (useWorkers) {
		try {
			workerResults = await dispatchToWorkerPool(filesToProcess, numWorkers);
		} catch {
			// Worker creation failed (e.g., in test/Node environment) — fall back
			workerResults = null;
		}
	}

	// Safety net: if workers returned results but extracted 0 facts, fall back to sequential
	if (workerResults && workerResults.length > 0 && !workerResults.some((r) => r.facts.length > 0)) {
		process.stderr.write(
			`sia: worker pool processed ${workerResults.length} files but extracted 0 facts — falling back to sequential\n`,
		);
		workerResults = null;
	}

	if (workerResults?.some((r) => r.facts.length > 0)) {
		// Process all worker results
		for (const result of workerResults) {
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
	} else {
		// Sequential fallback — process files one at a time via parseFileWithRetry
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

	// Store current HEAD so incremental reindex knows the baseline
	const head = getCurrentHead(root);
	if (head) {
		const repoDataDir = join(config.repoDir, repoHash);
		writeStoredHead(repoDataDir, head);

		// Backward compat: also write .sia-graph/last-indexed-commit
		const siaGraphDir = join(root, ".sia-graph");
		if (existsSync(siaGraphDir)) {
			writeFileSync(join(siaGraphDir, "last-indexed-commit"), head, "utf-8");
		}
	}

	return {
		filesProcessed,
		entitiesCreated,
		edgesCreated,
		cacheHits,
		durationMs: Date.now() - start,
		skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
	};
}
