// Module: dirty-tracker — Salsa-inspired dirty propagation engine
//
// Coordination layer for the freshness system. Maintains an in-memory map
// (NOT persisted to SQLite) of node dirty states. The push phase marks
// nodes dirty when source files change; the pull phase checks dirty state
// before serving query results.
//
// Key design decisions:
// - In-memory only — rebuilt from source_deps at startup
// - BFS propagation with firewall cutoff at high-fan-out nodes
// - Early cutoff: markClean does NOT propagate (content hash unchanged)
// - Durable nodes skip dirty when only volatile sources change

import { getOutgoingNeighbors } from "@/freshness/firewall";
import { getDependentsForFile } from "@/freshness/inverted-index";
import type { SiaDb } from "@/graph/db-interface";

export type DirtyState = "clean" | "dirty" | "maybe_dirty";
export type Durability = "volatile" | "durable";

/** Default BFS depth limit for dirty propagation. */
const DEFAULT_MAX_DEPTH = 2;

/** Default edge_count threshold above which a node is a firewall. */
const DEFAULT_FIREWALL_THRESHOLD = 50;

export class DirtyTracker {
	/** In-memory only — rebuilt from source_deps at startup. */
	private dirtyMap = new Map<string, DirtyState>();
	private durabilityMap = new Map<string, Durability>();

	/**
	 * Get the dirty state of a node. Nodes not in the map are assumed clean.
	 */
	getState(nodeId: string): DirtyState {
		return this.dirtyMap.get(nodeId) ?? "clean";
	}

	/**
	 * Phase 1 — Push: Mark nodes as dirty when their source files change.
	 * Called by Layer 1 (file-watcher) and Layer 2 (git-reconcile).
	 *
	 * Algorithm:
	 * 1. Look up source_deps[changedFile] -> affected_node_ids
	 * 2. For each affected node:
	 *    a. Skip if node is durable and only volatile sources changed
	 *    b. Set dirtyMap[nodeId] = 'dirty'
	 *    c. BFS outgoing dependency edges up to maxDepth (default 2)
	 *    d. For each neighbor:
	 *       - If edge_count > firewallThreshold (50): set 'maybe_dirty', STOP
	 *       - Else: set 'dirty', continue
	 */
	async markDirty(
		db: SiaDb,
		changedFile: string,
		opts?: { maxDepth?: number; firewallThreshold?: number },
	): Promise<string[]> {
		const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
		const firewallThreshold = opts?.firewallThreshold ?? DEFAULT_FIREWALL_THRESHOLD;

		// Step 1: Look up affected nodes from inverted index
		const deps = await getDependentsForFile(db, changedFile);
		if (deps.length === 0) return [];

		const newlyDirtied: string[] = [];

		// Step 2: Mark each affected node
		for (const dep of deps) {
			const nodeId = dep.node_id;

			// 2a: Skip durable nodes for volatile source changes
			const durability = this.durabilityMap.get(nodeId);
			if (durability === "durable") {
				continue;
			}

			// 2b: Set dirty
			this.dirtyMap.set(nodeId, "dirty");
			newlyDirtied.push(nodeId);

			// 2c-d: BFS outgoing edges
			const bfsDirtied = await this.bfsPropagation(db, nodeId, maxDepth, firewallThreshold);
			for (const id of bfsDirtied) {
				newlyDirtied.push(id);
			}
		}

		return newlyDirtied;
	}

	/**
	 * Phase 2 — Pull: Check and resolve dirty state for a node.
	 * Called by Layer 3 (stale-while-revalidate) before serving a query result.
	 *
	 * Returns:
	 * - 'clean': serve immediately
	 * - 'dirty': needs re-verification (caller must re-extract)
	 * - 'maybe_dirty': needs mtime check (caller does stat())
	 */
	checkNode(nodeId: string): DirtyState {
		return this.dirtyMap.get(nodeId) ?? "clean";
	}

	/**
	 * Mark a node as clean after successful re-verification.
	 * This is the early cutoff: if content hash unchanged, clear dirty
	 * WITHOUT propagating to dependents.
	 */
	markClean(nodeId: string): void {
		this.dirtyMap.delete(nodeId);
	}

	/**
	 * Mark a node as clean and propagate dirty to its dependents.
	 * Called when re-verification found the content actually changed.
	 */
	async markCleanAndPropagate(
		db: SiaDb,
		nodeId: string,
		opts?: { maxDepth?: number; firewallThreshold?: number },
	): Promise<string[]> {
		const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
		const firewallThreshold = opts?.firewallThreshold ?? DEFAULT_FIREWALL_THRESHOLD;

		// Clear this node
		this.dirtyMap.delete(nodeId);

		// Propagate to dependents
		return this.bfsPropagation(db, nodeId, maxDepth, firewallThreshold);
	}

	/**
	 * Set durability for a node. Durable nodes skip dirty-checking
	 * when only volatile sources change.
	 */
	setDurability(nodeId: string, durability: Durability): void {
		this.durabilityMap.set(nodeId, durability);
	}

	/**
	 * Clear all dirty state (used on restart or full reindex).
	 */
	reset(): void {
		this.dirtyMap.clear();
		this.durabilityMap.clear();
	}

	/**
	 * Get counts for diagnostics.
	 */
	getStats(): {
		clean: number;
		dirty: number;
		maybeDirty: number;
		total: number;
	} {
		let dirty = 0;
		let maybeDirty = 0;
		let clean = 0;

		for (const state of this.dirtyMap.values()) {
			switch (state) {
				case "dirty":
					dirty++;
					break;
				case "maybe_dirty":
					maybeDirty++;
					break;
				case "clean":
					clean++;
					break;
			}
		}

		return {
			clean,
			dirty,
			maybeDirty,
			total: this.dirtyMap.size,
		};
	}

	// -----------------------------------------------------------------
	// Internal BFS propagation
	// -----------------------------------------------------------------

	/**
	 * BFS propagation from a starting node through outgoing dependency edges.
	 *
	 * For each neighbor:
	 * - If edge_count > firewallThreshold: set 'maybe_dirty', STOP (don't enqueue)
	 * - Else: set 'dirty', continue BFS
	 *
	 * Returns list of newly-dirtied node IDs (excluding the start node).
	 */
	private async bfsPropagation(
		db: SiaDb,
		startNodeId: string,
		maxDepth: number,
		firewallThreshold: number,
	): Promise<string[]> {
		const newlyDirtied: string[] = [];
		const visited = new Set<string>([startNodeId]);

		// BFS queue: [nodeId, currentDepth]
		const queue: Array<[string, number]> = [[startNodeId, 0]];

		while (queue.length > 0) {
			const entry = queue.shift();
			if (!entry) break;
			const [currentId, depth] = entry;

			if (depth >= maxDepth) continue;

			const neighbors = await getOutgoingNeighbors(db, currentId);

			for (const neighbor of neighbors) {
				if (visited.has(neighbor.nodeId)) continue;
				visited.add(neighbor.nodeId);

				if (neighbor.edgeCount > firewallThreshold) {
					// Firewall node: mark maybe_dirty and STOP propagation
					this.dirtyMap.set(neighbor.nodeId, "maybe_dirty");
					newlyDirtied.push(neighbor.nodeId);
					// Do NOT enqueue — BFS stops here
				} else {
					// Normal node: mark dirty and continue BFS
					this.dirtyMap.set(neighbor.nodeId, "dirty");
					newlyDirtied.push(neighbor.nodeId);
					queue.push([neighbor.nodeId, depth + 1]);
				}
			}
		}

		return newlyDirtied;
	}
}
