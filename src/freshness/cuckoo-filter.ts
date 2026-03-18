// Module: cuckoo-filter — Probabilistic set membership with deletion support
//
// Used to quickly answer "does this file have ANY derived nodes?" without
// hitting SQLite. For Phase 15 we implement a simplified version using a
// Set<string> as the backing store. This provides the correct API and O(1)
// lookup while avoiding the complexity of a real Cuckoo filter implementation.
// The memory overhead for 50K paths (~100KB as Set) is acceptable.
// A real Cuckoo filter can be swapped in later if memory becomes an issue.

import type { SiaDb } from "@/graph/db-interface";

export class CuckooFilter {
	private paths: Set<string>;

	constructor() {
		this.paths = new Set();
	}

	/** Add a source path to the filter. */
	add(path: string): void {
		this.paths.add(path);
	}

	/** Remove a source path from the filter. */
	remove(path: string): void {
		this.paths.delete(path);
	}

	/** O(1) membership check — the critical method. */
	contains(path: string): boolean {
		return this.paths.has(path);
	}

	/** Clear all entries from the filter. */
	clear(): void {
		this.paths.clear();
	}

	/** Number of distinct paths in the filter. */
	get size(): number {
		return this.paths.size;
	}

	/**
	 * Rebuild the filter from the source_deps table.
	 * Loads all distinct source_path values into the Set.
	 */
	static async fromDatabase(db: SiaDb): Promise<CuckooFilter> {
		const filter = new CuckooFilter();
		const { rows } = await db.execute("SELECT DISTINCT source_path FROM source_deps");
		for (const row of rows) {
			filter.add(row.source_path as string);
		}
		return filter;
	}
}
