// Module: stale-read-layer — Layer 3 per-query freshness validation
//
// Provides stale-while-revalidate semantics for node reads.
// When a node is accessed during retrieval this layer determines whether
// it is Fresh, Stale, or Rotten by comparing source file mtimes against
// the node's t_created timestamp.
//
// Fresh:  source unchanged since extraction   → serve immediately (< 0.05ms)
// Stale:  source modified within window       → serve + async re-validate
// Rotten: source modified beyond window       → block until re-validated
//
// For nodes with multiple source files, only the most-recently-modified
// source is stat()-checked — if it has not changed, none have (optimistic
// fast path).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SiaDb } from "@/graph/db-interface";
import type { DirtyTracker } from "./dirty-tracker";
import { getDependenciesForNode } from "./inverted-index";

export type FreshnessState = "fresh" | "stale" | "rotten";

export interface FreshnessCheck {
	state: FreshnessState;
	sourcePath?: string; // the source file checked
	sourceMtime?: number; // source file mtime (ms)
	extractionTime?: number; // when the node was extracted (t_created ms)
	divergenceSeconds?: number; // (mtime - t_created) / 1000
}

export interface StalenessConfig {
	activeEditWindowMs: number; // default 30_000 (30s)
	sessionCommitWindowMs: number; // default 300_000 (5min)
	defaultWindowMs: number; // default Infinity (event-driven via Layers 1-2)
}

const DEFAULT_CONFIG: StalenessConfig = {
	activeEditWindowMs: 30_000,
	sessionCommitWindowMs: 300_000,
	defaultWindowMs: Number.POSITIVE_INFINITY,
};

// ---------------------------------------------------------------------------
// checkFreshness
// ---------------------------------------------------------------------------

/**
 * Check the freshness of a node by comparing source file mtimes.
 *
 * Algorithm:
 * 1. If tracker.checkNode(nodeId) is 'clean' → return Fresh (no stat() needed)
 * 2. Get source files via getDependenciesForNode()
 * 3. If no source files → return Fresh (no dependency to check)
 * 4. stat() the most recently modified source file
 * 5. Compare mtime against node's t_created timestamp
 * 6. If mtime <= t_created → Fresh (source unchanged)
 * 7. If mtime > t_created and within staleness window → Stale
 * 8. If mtime > t_created and beyond staleness window → Rotten
 */
export async function checkFreshness(
	db: SiaDb,
	nodeId: string,
	tracker: DirtyTracker,
	repoRoot: string,
	config?: Partial<StalenessConfig>,
): Promise<FreshnessCheck> {
	const cfg: StalenessConfig = { ...DEFAULT_CONFIG, ...config };

	// Step 1: fast path — if tracker says clean, no stat() needed
	const dirtyState = tracker.checkNode(nodeId);
	if (dirtyState === "clean") {
		return { state: "fresh" };
	}

	// Step 2: get source dependencies for this node
	const deps = await getDependenciesForNode(db, nodeId);

	// Step 3: no dependencies → treat as fresh (nothing to check)
	if (deps.length === 0) {
		return { state: "fresh" };
	}

	// Step 4: select the most recently modified source file recorded in source_deps.
	// source_mtime is the recorded mtime at extraction time; the dep with the
	// highest recorded mtime is most likely to have diverged.
	const primaryDep = deps.reduce((best, d) => (d.source_mtime > best.source_mtime ? d : best));

	const sourcePath = primaryDep.source_path;

	// Step 4a: resolve path — if not absolute, join with repoRoot
	const resolvedPath = sourcePath.startsWith("/") ? sourcePath : join(repoRoot, sourcePath);

	// Handle missing file (deleted) → Rotten
	if (!existsSync(resolvedPath)) {
		return { state: "rotten", sourcePath };
	}

	let sourceMtime: number;
	try {
		sourceMtime = statSync(resolvedPath).mtimeMs;
	} catch {
		// stat error (permission denied, race condition, etc.) → Rotten
		return { state: "rotten", sourcePath };
	}

	// Step 5: get node's t_created from the database
	const { rows } = await db.execute("SELECT t_created FROM entities WHERE id = ?", [nodeId]);
	if (rows.length === 0) {
		// Node not found — treat as rotten
		return { state: "rotten", sourcePath, sourceMtime };
	}

	const extractionTime = rows[0].t_created as number;

	// Step 6: source unchanged → Fresh
	if (sourceMtime <= extractionTime) {
		return { state: "fresh", sourcePath, sourceMtime, extractionTime };
	}

	// Source was modified after extraction — compute divergence
	const divergenceMs = sourceMtime - extractionTime;
	const divergenceSeconds = divergenceMs / 1000;

	// Step 7: within staleness window → Stale
	if (divergenceMs <= cfg.activeEditWindowMs || divergenceMs <= cfg.sessionCommitWindowMs) {
		return { state: "stale", sourcePath, sourceMtime, extractionTime, divergenceSeconds };
	}

	// Step 8: beyond staleness window → Rotten
	return { state: "rotten", sourcePath, sourceMtime, extractionTime, divergenceSeconds };
}

// ---------------------------------------------------------------------------
// readRepair
// ---------------------------------------------------------------------------

/**
 * Perform read-repair: re-read source and compare content hash against the
 * stored node content.
 *
 * Algorithm:
 * 1. Get source files for the node
 * 2. Re-read the primary source file content
 * 3. Hash the content and compare against stored content hash
 * 4. If content unchanged → tracker.markClean(nodeId) (early cutoff), return false
 * 5. If changed → update node, tracker.markCleanAndPropagate(), return true
 *
 * Returns true if the node content changed (not an early cutoff).
 */
export async function readRepair(
	db: SiaDb,
	nodeId: string,
	tracker: DirtyTracker,
	repoRoot: string,
): Promise<boolean> {
	// Step 1: get source files for the node
	const deps = await getDependenciesForNode(db, nodeId);

	if (deps.length === 0) {
		// No source to compare — mark clean (nothing to repair)
		tracker.markClean(nodeId);
		return false;
	}

	// Select the primary source (highest recorded mtime — most likely changed)
	const primaryDep = deps.reduce((best, d) => (d.source_mtime > best.source_mtime ? d : best));

	const sourcePath = primaryDep.source_path;
	const resolvedPath = sourcePath.startsWith("/") ? sourcePath : join(repoRoot, sourcePath);

	// Step 2: re-read the source file
	let sourceContent: string;
	try {
		sourceContent = readFileSync(resolvedPath, "utf8");
	} catch {
		// File unreadable (deleted, permission error) — mark clean to avoid
		// repeated repair attempts; caller should handle rotten state separately
		tracker.markClean(nodeId);
		return false;
	}

	// Step 3: hash the current source content
	const sourceHash = sha256(sourceContent);

	// Fetch the stored node content and hash it
	const { rows } = await db.execute("SELECT content FROM entities WHERE id = ?", [nodeId]);

	if (rows.length === 0) {
		tracker.markClean(nodeId);
		return false;
	}

	const storedContent = rows[0].content as string;
	const storedHash = sha256(storedContent);

	// Step 4: hashes match — content unchanged (early cutoff)
	if (sourceHash === storedHash) {
		tracker.markClean(nodeId);
		return false;
	}

	// Step 5: content changed — update the node and propagate
	const now = Date.now();
	await db.execute("UPDATE entities SET content = ?, t_created = ? WHERE id = ?", [
		sourceContent,
		now,
		nodeId,
	]);

	await tracker.markCleanAndPropagate(db, nodeId);
	return true;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sha256(data: string): string {
	return createHash("sha256").update(data).digest("hex");
}
