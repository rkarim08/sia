// Module: snapshots — Daily snapshot creation and rollback + branch-keyed snapshots

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";
import { SIA_HOME } from "@/shared/config";

/** Shape of a serialized snapshot file. */
export interface SnapshotData {
	version: 1;
	timestamp: number;
	entities: Record<string, unknown>[];
	edges: Record<string, unknown>[];
}

/**
 * Build the snapshot directory path for a given repo.
 */
function snapshotDir(repoHash: string, siaHome?: string): string {
	const home = siaHome ?? SIA_HOME;
	return join(home, "snapshots", repoHash);
}

/**
 * Format a Date as YYYY-MM-DD.
 */
function formatDate(d: Date): string {
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse a YYYY-MM-DD date string into a Unix ms timestamp (midnight UTC).
 */
function parseDateFromFilename(filename: string): number {
	// Extract YYYY-MM-DD from "YYYY-MM-DD.snapshot"
	const datePart = basename(filename, ".snapshot");
	const [yearStr, monthStr, dayStr] = datePart.split("-");
	const year = Number(yearStr);
	const month = Number(monthStr) - 1; // JS months are 0-indexed
	const day = Number(dayStr);
	return Date.UTC(year, month, day);
}

/**
 * Create a snapshot of all active entities and edges.
 *
 * Active entities: t_valid_until IS NULL AND archived_at IS NULL
 * Active edges: t_valid_until IS NULL
 *
 * Writes JSON to `{siaHome}/snapshots/{repoHash}/YYYY-MM-DD.snapshot`.
 * Returns the snapshot file path.
 */
export async function createSnapshot(
	db: SiaDb,
	repoHash: string,
	siaHome?: string,
): Promise<string> {
	const dir = snapshotDir(repoHash, siaHome);
	mkdirSync(dir, { recursive: true });

	// Query active entities
	const entitiesResult = await db.execute(
		"SELECT * FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
	);

	// Query active edges
	const edgesResult = await db.execute("SELECT * FROM graph_edges WHERE t_valid_until IS NULL");

	const now = Date.now();
	const data: SnapshotData = {
		version: 1,
		timestamp: now,
		entities: entitiesResult.rows,
		edges: edgesResult.rows,
	};

	const filename = `${formatDate(new Date(now))}.snapshot`;
	const filepath = join(dir, filename);

	writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");

	await writeAuditEntry(db, "ADD", { snapshot_id: filepath });

	return filepath;
}

/**
 * List all snapshot files for a repo, sorted by date (oldest first).
 */
export function listSnapshots(repoHash: string, siaHome?: string): string[] {
	const dir = snapshotDir(repoHash, siaHome);

	if (!existsSync(dir)) {
		return [];
	}

	const files = readdirSync(dir)
		.filter((f) => f.endsWith(".snapshot"))
		.sort();

	return files.map((f) => join(dir, f));
}

/**
 * Find the snapshot file closest to and before a target timestamp.
 *
 * Returns the full path, or null if no snapshot exists before the target.
 */
export function findNearestSnapshot(
	repoHash: string,
	targetTimestamp: number,
	siaHome?: string,
): string | null {
	const snapshots = listSnapshots(repoHash, siaHome);

	let best: string | null = null;
	let bestTs = -1;

	for (const snap of snapshots) {
		const ts = parseDateFromFilename(basename(snap));
		if (ts <= targetTimestamp && ts > bestTs) {
			best = snap;
			bestTs = ts;
		}
	}

	return best;
}

/**
 * Restore a snapshot: create a pre-rollback snapshot first (atomicity),
 * then delete all entities and edges, re-insert from the snapshot JSON.
 */
export async function restoreSnapshot(
	db: SiaDb,
	snapshotPath: string,
	repoHash: string,
	siaHome?: string,
): Promise<void> {
	// Step 1: Read the snapshot file BEFORE creating the pre-rollback snapshot
	// to avoid the pre-rollback overwriting the same date-based filename.
	const raw = readFileSync(snapshotPath, "utf-8");
	const data = JSON.parse(raw) as SnapshotData;

	// Step 2: Create a pre-rollback snapshot for safety
	await createSnapshot(db, repoHash, siaHome);

	// Step 3: Delete all existing entities and edges, then re-insert from snapshot.
	await db.transaction(async (tx) => {
		// Delete edges first (FK constraint: edges reference entities)
		await tx.execute("DELETE FROM graph_edges");
		// Delete entities
		await tx.execute("DELETE FROM graph_nodes");

		// Re-insert entities
		for (const entity of data.entities) {
			const columns = Object.keys(entity);
			const placeholders = columns.map(() => "?").join(", ");
			const values = columns.map((col) => entity[col] ?? null);
			const sql = `INSERT INTO graph_nodes (${columns.join(", ")}) VALUES (${placeholders})`;
			await tx.execute(sql, values);
		}

		// Re-insert edges
		for (const edge of data.edges) {
			const columns = Object.keys(edge);
			const placeholders = columns.map(() => "?").join(", ");
			const values = columns.map((col) => edge[col] ?? null);
			const sql = `INSERT INTO graph_edges (${columns.join(", ")}) VALUES (${placeholders})`;
			await tx.execute(sql, values);
		}
	});

	// Step 4: Write audit entry for the restore
	await writeAuditEntry(db, "UPDATE", { snapshot_id: snapshotPath });
}

// ---------------------------------------------------------------------------
// Branch-keyed snapshots (stored in SQLite, not on disk)
// ---------------------------------------------------------------------------

/** Shape of a branch snapshot row. */
export interface BranchSnapshot {
	id: number;
	branch_name: string;
	commit_hash: string;
	node_count: number;
	edge_count: number;
	snapshot_data: string;
	created_at: number;
	updated_at: number;
}

/**
 * Create (or update) a branch snapshot.
 * Serializes all active nodes and edges into JSON and UPSERTs into
 * the branch_snapshots table. Each branch gets exactly one snapshot row.
 */
export async function createBranchSnapshot(
	db: SiaDb,
	branchName: string,
	commitHash: string,
): Promise<void> {
	const { rows: nodes } = await db.execute(
		"SELECT * FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
	);
	const { rows: edges } = await db.execute(
		"SELECT * FROM graph_edges WHERE t_valid_until IS NULL",
	);

	const snapshotData = JSON.stringify({ nodes, edges });
	const now = Date.now();

	await db.execute(
		`INSERT INTO branch_snapshots (branch_name, commit_hash, node_count, edge_count, snapshot_data, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(branch_name) DO UPDATE SET
		   commit_hash = excluded.commit_hash,
		   node_count = excluded.node_count,
		   edge_count = excluded.edge_count,
		   snapshot_data = excluded.snapshot_data,
		   updated_at = excluded.updated_at`,
		[branchName, commitHash, nodes.length, edges.length, snapshotData, now, now],
	);

	await writeAuditEntry(db, "ADD", { branch_snapshot: branchName, commit: commitHash });
}

/**
 * Restore graph state from a branch snapshot.
 * Deletes all current nodes/edges, then re-inserts from the snapshot.
 * Returns true if a snapshot was found and restored, false otherwise.
 */
export async function restoreBranchSnapshot(
	db: SiaDb,
	branchName: string,
): Promise<boolean> {
	const { rows } = await db.execute(
		"SELECT snapshot_data FROM branch_snapshots WHERE branch_name = ?",
		[branchName],
	);

	if (rows.length === 0) return false;

	const data = JSON.parse(rows[0].snapshot_data as string) as {
		nodes: Record<string, unknown>[];
		edges: Record<string, unknown>[];
	};

	await db.transaction(async (tx) => {
		await tx.execute("DELETE FROM graph_edges");
		await tx.execute("DELETE FROM graph_nodes");

		for (const node of data.nodes) {
			const columns = Object.keys(node);
			const placeholders = columns.map(() => "?").join(", ");
			const values = columns.map((col) => node[col] ?? null);
			await tx.execute(
				`INSERT INTO graph_nodes (${columns.join(", ")}) VALUES (${placeholders})`,
				values,
			);
		}

		for (const edge of data.edges) {
			const columns = Object.keys(edge);
			const placeholders = columns.map(() => "?").join(", ");
			const values = columns.map((col) => edge[col] ?? null);
			await tx.execute(
				`INSERT INTO graph_edges (${columns.join(", ")}) VALUES (${placeholders})`,
				values,
			);
		}
	});

	await writeAuditEntry(db, "UPDATE", { branch_snapshot_restore: branchName });
	return true;
}

/**
 * List all branch snapshots, ordered by updated_at descending.
 */
export async function listBranchSnapshots(db: SiaDb): Promise<BranchSnapshot[]> {
	const { rows } = await db.execute(
		"SELECT id, branch_name, commit_hash, node_count, edge_count, snapshot_data, created_at, updated_at FROM branch_snapshots ORDER BY updated_at DESC",
	);
	return rows as unknown as BranchSnapshot[];
}

/**
 * Prune snapshots for specific branches (e.g., deleted branches).
 * Returns the number of snapshots deleted.
 */
export async function pruneBranchSnapshots(
	db: SiaDb,
	branchNames: string[],
): Promise<number> {
	if (branchNames.length === 0) return 0;

	const { rows: before } = await db.execute(
		"SELECT COUNT(*) as cnt FROM branch_snapshots",
	);

	const placeholders = branchNames.map(() => "?").join(", ");
	await db.execute(
		`DELETE FROM branch_snapshots WHERE branch_name IN (${placeholders})`,
		branchNames,
	);

	const { rows: after } = await db.execute(
		"SELECT COUNT(*) as cnt FROM branch_snapshots",
	);

	const deleted = Number(before[0].cnt) - Number(after[0].cnt);
	if (deleted > 0) {
		await writeAuditEntry(db, "DELETE", { pruned_branch_snapshots: branchNames });
	}
	return deleted;
}

/**
 * Garbage-collect branch snapshots older than ttlDays.
 * Returns the number of snapshots deleted.
 */
export async function gcBranchSnapshots(
	db: SiaDb,
	ttlDays: number,
): Promise<number> {
	const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;

	const { rows: before } = await db.execute(
		"SELECT COUNT(*) as cnt FROM branch_snapshots",
	);

	await db.execute(
		"DELETE FROM branch_snapshots WHERE updated_at < ?",
		[cutoff],
	);

	const { rows: after } = await db.execute(
		"SELECT COUNT(*) as cnt FROM branch_snapshots",
	);

	const deleted = Number(before[0].cnt) - Number(after[0].cnt);
	if (deleted > 0) {
		await writeAuditEntry(db, "DELETE", { gc_branch_snapshots: deleted, ttl_days: ttlDays });
	}
	return deleted;
}
