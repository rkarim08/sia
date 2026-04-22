// Module: engine — Core augmentation logic: search graph and format context

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import {
	type AugmentEdge,
	type AugmentEntity,
	formatContext,
} from "@/hooks/augmentation/formatter";
import { SessionCache } from "@/hooks/augmentation/session-cache";
import { bm25Search } from "@/retrieval/bm25-search";

/** Maximum number of entities to fetch details for. */
const MAX_ENTITIES = 3;

/** LRU cache size for augment results keyed on query string (Phase 4 §4.4 cost mitigation). */
const AUGMENT_LRU_MAX = 32;

/** Minimum query length — patterns shorter than this skip augmentation entirely. */
const MIN_QUERY_LENGTH = 3;

/**
 * Module-level LRU cache keyed on BM25 query string.
 *
 * Scope: per-process. Since augment-hook runs as a short-lived subprocess
 * (one invocation per PreToolUse event), this cache primarily dedups
 * within the lifetime of a single worker process. When the process is
 * reused across hook invocations (e.g. hot-restart in `bun run`), the
 * cache hit counter in stderr becomes meaningful across calls.
 *
 * Not shared across sessions — there is no cross-process state.
 *
 * Implementation: `Map` preserves insertion order in ES2015+, so we
 * delete-and-reinsert on hit to move the key to the "most recently used"
 * end, and evict the oldest entry (first key) on overflow.
 */
const augmentLru = new Map<string, string>();

/** Exported for tests only — reset LRU state between runs. */
export function __resetAugmentLruForTests(): void {
	augmentLru.clear();
}

function lruGet(key: string): string | undefined {
	if (!augmentLru.has(key)) return undefined;
	const val = augmentLru.get(key) as string;
	// Move to most-recently-used end.
	augmentLru.delete(key);
	augmentLru.set(key, val);
	return val;
}

function lruSet(key: string, value: string): void {
	if (augmentLru.has(key)) {
		augmentLru.delete(key);
	} else if (augmentLru.size >= AUGMENT_LRU_MAX) {
		// Evict the oldest entry (first key in insertion order).
		const oldest = augmentLru.keys().next().value;
		if (oldest !== undefined) augmentLru.delete(oldest);
	}
	augmentLru.set(key, value);
}

/**
 * Augment a search pattern with SIA graph context.
 *
 * Steps:
 * 1. Check augment-enabled flag (default: enabled)
 * 2. Check indexing.lock (skip if locked)
 * 3. Check session cache for dedup
 * 4. Open SIA database (read-only)
 * 5. Run BM25 search
 * 6. Fetch 1-hop edges for top results
 * 7. Format via formatter
 * 8. Mark pattern as augmented
 * 9. Return formatted context
 */
export async function augment(pattern: string, siaGraphDir: string): Promise<string> {
	// Step 0a: Skip trivially short queries — BM25 produces noise for <3 char
	// patterns and the per-call cost is not worth the signal.
	if (pattern.length < MIN_QUERY_LENGTH) {
		return "";
	}

	// Step 0b: Check the module-level LRU cache. A hit short-circuits
	// everything else (enabled flag check, lock file, DB open). This is
	// safe because the cache only lives for the lifetime of the process
	// and any state change (lock acquired, flag flipped) tears the
	// process down before the next hook invocation.
	const cached = lruGet(pattern);
	if (cached !== undefined) {
		process.stderr.write("[sia] augment cache hit\n");
		return cached;
	}

	// Step 1: Check augment-enabled flag (default: enabled)
	if (!isAugmentEnabled(siaGraphDir)) {
		return "";
	}

	// Step 2: Check indexing.lock
	if (existsSync(join(siaGraphDir, "indexing.lock"))) {
		return "";
	}

	// Step 3: Check session cache for dedup
	const cachePath = join(siaGraphDir, "augment-cache.json");
	const cache = new SessionCache(cachePath);
	if (cache.hasAugmented(pattern)) {
		return "";
	}

	// Step 4: Open SIA database
	const cwd = dirname(siaGraphDir); // .sia-graph is at project root
	const repoHash = resolveRepoHash(cwd);
	const db = openGraphDb(repoHash);

	try {
		// Step 5: Run BM25 search
		const results = await bm25Search(db, pattern, { limit: MAX_ENTITIES });
		if (results.length === 0) {
			// Mark as augmented even on empty results to avoid re-querying
			cache.markAugmented(pattern);
			lruSet(pattern, "");
			return "";
		}

		// Step 6: Fetch entity details and 1-hop edges for top results
		const entities: AugmentEntity[] = [];
		for (const result of results.slice(0, MAX_ENTITIES)) {
			const entity = await fetchEntityWithEdges(db, result.entityId);
			if (entity) {
				entities.push(entity);
			}
		}

		// Step 7: Format
		const formatted = formatContext(pattern, entities);

		// Step 8: Mark pattern as augmented
		cache.markAugmented(pattern);

		// Step 8b: Store in LRU for fast return on repeat queries in-process.
		lruSet(pattern, formatted);

		// Step 9: Return
		return formatted;
	} finally {
		await db.close();
	}
}

/**
 * Check if augmentation is enabled. Default is true if the flag file
 * does not exist or contains anything other than "false".
 */
function isAugmentEnabled(siaGraphDir: string): boolean {
	const flagPath = join(siaGraphDir, "augment-enabled");
	if (!existsSync(flagPath)) {
		return true; // enabled by default
	}
	try {
		const content = readFileSync(flagPath, "utf-8").trim().toLowerCase();
		return content !== "false";
	} catch {
		return true;
	}
}

/**
 * Fetch an entity's details and its 1-hop outgoing edges.
 */
async function fetchEntityWithEdges(
	db: Awaited<ReturnType<typeof openGraphDb>>,
	entityId: string,
): Promise<AugmentEntity | null> {
	// Fetch entity
	const entityResult = await db.execute(
		`SELECT id, name, type, file_paths, trust_tier, summary
		 FROM graph_nodes
		 WHERE id = ? AND t_valid_until IS NULL AND archived_at IS NULL`,
		[entityId],
	);

	const row = entityResult.rows[0] as
		| {
				id: string;
				name: string;
				type: string;
				file_paths: string;
				trust_tier: number;
				summary: string;
		  }
		| undefined;

	if (!row) return null;

	let filePaths: string[] = [];
	try {
		filePaths = JSON.parse(row.file_paths as string);
	} catch {
		// Ignore parse errors
	}

	// Fetch 1-hop edges (outgoing from this entity)
	const edgeResult = await db.execute(
		`SELECT n.name AS target_name, e.type
		 FROM graph_edges e
		 JOIN graph_nodes n ON n.id = e.to_id
		 WHERE e.from_id = ? AND e.t_valid_until IS NULL
		 LIMIT 3`,
		[entityId],
	);

	const edges: AugmentEdge[] = (
		edgeResult.rows as Array<{ target_name: string; type: string }>
	).map((e) => ({
		targetName: e.target_name,
		edgeType: e.type,
	}));

	// Check if entity is a Decision or Convention type for annotation
	let decision: { description: string; date: string } | undefined;
	if (row.type === "Decision" || row.type === "Convention") {
		decision = {
			description: row.summary ?? row.name,
			date: new Date().toISOString().split("T")[0],
		};
	}

	return {
		id: row.id,
		name: row.name,
		type: row.type,
		filePaths,
		trustTier: row.trust_tier,
		edges,
		decision,
	};
}
