// Module: firewall — Detects high-fan-out nodes that stop dirty propagation
//
// Firewall nodes have more than `threshold` incoming edges. When BFS dirty
// propagation reaches a firewall node, it marks the node as 'maybe_dirty'
// and stops — preventing cascading invalidation through hub nodes like
// utils/helpers.ts that are imported by hundreds of files.

import type { SiaDb } from "@/graph/db-interface";

/** Default edge_count threshold above which a node is a firewall. */
const DEFAULT_FIREWALL_THRESHOLD = 50;

/**
 * Check if a node is a firewall — has more than threshold incoming edges.
 * Firewall nodes stop dirty propagation to prevent cascading invalidation
 * (e.g., utils/helpers.ts imported by 200 files shouldn't cascade to all 200).
 *
 * Uses the denormalized `edge_count` column on the entities table for O(1) lookup.
 * Returns false for unknown nodes (not in the database).
 */
export async function isFirewallNode(
	db: SiaDb,
	nodeId: string,
	threshold?: number,
): Promise<boolean> {
	const limit = threshold ?? DEFAULT_FIREWALL_THRESHOLD;

	const { rows } = await db.execute("SELECT edge_count FROM graph_nodes WHERE id = ?", [nodeId]);

	if (rows.length === 0) return false;

	const edgeCount = rows[0].edge_count as number;
	return edgeCount > limit;
}

/**
 * Get the outgoing neighbors of a node for BFS propagation.
 * Only follows active edges (t_valid_until IS NULL).
 * Returns the neighbor node ID along with its edge_count (for firewall checks).
 *
 * "Outgoing" here means both directions — edges where this node is the source
 * (from_id) or the target (to_id) — because dependency relationships are
 * bidirectional for invalidation purposes.
 */
export async function getOutgoingNeighbors(
	db: SiaDb,
	nodeId: string,
): Promise<Array<{ nodeId: string; edgeCount: number }>> {
	const { rows } = await db.execute(
		`SELECT
			CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END AS neighbor_id,
			ent.edge_count
		 FROM graph_edges e
		 JOIN graph_nodes ent ON ent.id = CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END
		 WHERE (e.from_id = ? OR e.to_id = ?)
		   AND e.t_valid_until IS NULL`,
		[nodeId, nodeId, nodeId, nodeId],
	);

	return rows.map((r) => ({
		nodeId: r.neighbor_id as string,
		edgeCount: r.edge_count as number,
	}));
}
