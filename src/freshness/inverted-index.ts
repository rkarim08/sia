// Module: inverted-index — CRUD for the source_deps inverted dependency index
//
// Maps source files to the graph entities derived from them. When a file
// changes, getDependentsForFile returns the exact set of entities that may
// be stale and require revalidation.

import type { SiaDb } from "@/graph/db-interface";

/** A single source-file-to-entity dependency mapping. */
export interface SourceDep {
	source_path: string;
	node_id: string;
	dep_type: "defines" | "extracted_from" | "pertains_to" | "references";
	source_mtime: number;
}

/**
 * Add a source -> node dependency mapping.
 * Uses INSERT OR REPLACE for idempotency — re-inserting the same
 * (source_path, node_id) pair updates dep_type and source_mtime.
 */
export async function addDependency(db: SiaDb, dep: SourceDep): Promise<void> {
	await db.execute(
		`INSERT OR REPLACE INTO source_deps (source_path, node_id, dep_type, source_mtime)
		 VALUES (?, ?, ?, ?)`,
		[dep.source_path, dep.node_id, dep.dep_type, dep.source_mtime],
	);
}

/** Remove a specific source -> node dependency. */
export async function removeDependency(
	db: SiaDb,
	sourcePath: string,
	nodeId: string,
): Promise<void> {
	await db.execute("DELETE FROM source_deps WHERE source_path = ? AND node_id = ?", [
		sourcePath,
		nodeId,
	]);
}

/** Remove all dependencies for a node (used when a node is invalidated). */
export async function removeDependenciesForNode(db: SiaDb, nodeId: string): Promise<void> {
	await db.execute("DELETE FROM source_deps WHERE node_id = ?", [nodeId]);
}

/**
 * Get all nodes derived from a source file.
 * This is the core invalidation query — when file X changes, this returns
 * every entity that may need revalidation.
 */
export async function getDependentsForFile(db: SiaDb, sourcePath: string): Promise<SourceDep[]> {
	const { rows } = await db.execute(
		"SELECT source_path, node_id, dep_type, source_mtime FROM source_deps WHERE source_path = ?",
		[sourcePath],
	);
	return rows as unknown as SourceDep[];
}

/** Get all source files that an entity depends on. */
export async function getDependenciesForNode(db: SiaDb, nodeId: string): Promise<SourceDep[]> {
	const { rows } = await db.execute(
		"SELECT source_path, node_id, dep_type, source_mtime FROM source_deps WHERE node_id = ?",
		[nodeId],
	);
	return rows as unknown as SourceDep[];
}

/** Get all distinct source paths (used for Cuckoo filter rebuild). */
export async function getAllSourcePaths(db: SiaDb): Promise<string[]> {
	const { rows } = await db.execute("SELECT DISTINCT source_path FROM source_deps");
	return rows.map((r) => r.source_path as string);
}

/**
 * Rebuild the entire inverted index from existing graph data.
 *
 * - For each entity with a non-empty `file_paths` JSON array, creates
 *   'defines' dependencies from each path to that entity.
 * - For each active `pertains_to` edge whose target entity has file_paths,
 *   creates 'pertains_to' dependencies from those target paths to the
 *   source entity.
 *
 * Returns the total count of dependencies created.
 */
export async function rebuildFromGraph(db: SiaDb): Promise<number> {
	// Clear existing deps
	await db.execute("DELETE FROM source_deps", []);

	let count = 0;
	const now = Date.now();

	// 1. Entities with file_paths -> 'defines' deps
	const { rows: entities } = await db.execute(
		`SELECT id, file_paths FROM entities
		 WHERE archived_at IS NULL AND t_valid_until IS NULL
		   AND file_paths IS NOT NULL AND file_paths != '[]'`,
	);

	for (const entity of entities) {
		const id = entity.id as string;
		const filePathsRaw = entity.file_paths as string;
		let paths: string[];
		try {
			paths = JSON.parse(filePathsRaw);
		} catch {
			continue;
		}
		if (!Array.isArray(paths)) continue;

		for (const p of paths) {
			if (typeof p !== "string" || p.length === 0) continue;
			await addDependency(db, {
				source_path: p,
				node_id: id,
				dep_type: "defines",
				source_mtime: now,
			});
			count++;
		}
	}

	// 2. pertains_to edges: source entity depends on target's file_paths
	const { rows: edges } = await db.execute(
		`SELECT e.from_id, t.file_paths
		 FROM edges e
		 JOIN entities t ON t.id = e.to_id
		 WHERE e.type = 'pertains_to'
		   AND e.t_valid_until IS NULL
		   AND t.archived_at IS NULL AND t.t_valid_until IS NULL
		   AND t.file_paths IS NOT NULL AND t.file_paths != '[]'`,
	);

	for (const edge of edges) {
		const fromId = edge.from_id as string;
		const filePathsRaw = edge.file_paths as string;
		let paths: string[];
		try {
			paths = JSON.parse(filePathsRaw);
		} catch {
			continue;
		}
		if (!Array.isArray(paths)) continue;

		for (const p of paths) {
			if (typeof p !== "string" || p.length === 0) continue;
			await addDependency(db, {
				source_path: p,
				node_id: fromId,
				dep_type: "pertains_to",
				source_mtime: now,
			});
			count++;
		}
	}

	return count;
}
