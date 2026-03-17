// Module: snapshots — Daily snapshot creation and rollback

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
		"SELECT * FROM entities WHERE t_valid_until IS NULL AND archived_at IS NULL",
	);

	// Query active edges
	const edgesResult = await db.execute("SELECT * FROM edges WHERE t_valid_until IS NULL");

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
		await tx.execute("DELETE FROM edges");
		// Delete entities
		await tx.execute("DELETE FROM entities");

		// Re-insert entities
		for (const entity of data.entities) {
			const columns = Object.keys(entity);
			const placeholders = columns.map(() => "?").join(", ");
			const values = columns.map((col) => entity[col] ?? null);
			const sql = `INSERT INTO entities (${columns.join(", ")}) VALUES (${placeholders})`;
			await tx.execute(sql, values);
		}

		// Re-insert edges
		for (const edge of data.edges) {
			const columns = Object.keys(edge);
			const placeholders = columns.map(() => "?").join(", ");
			const values = columns.map((col) => edge[col] ?? null);
			const sql = `INSERT INTO edges (${columns.join(", ")}) VALUES (${placeholders})`;
			await tx.execute(sql, values);
		}
	});

	// Step 4: Write audit entry for the restore
	await writeAuditEntry(db, "UPDATE", { snapshot_id: snapshotPath });
}
