// Module: audit — Append-only audit log write layer

import { randomUUID } from "node:crypto";
import type { SiaDb } from "@/graph/db-interface";

/** All supported audit operations (ARCHI v4.1 schema). */
export type AuditOperation =
	| "ADD"
	| "UPDATE"
	| "INVALIDATE"
	| "NOOP"
	| "STAGE"
	| "PROMOTE"
	| "QUARANTINE"
	| "SYNC_RECV"
	| "SYNC_SEND"
	| "ARCHIVE"
	| "VSS_REFRESH";

/** Optional detail fields matching audit_log columns. */
export interface AuditDetails {
	entity_id?: string;
	edge_id?: string;
	source_episode?: string;
	trust_tier?: number;
	extraction_method?: string;
	source_hash?: string;
	developer_id?: string;
	snapshot_id?: string;
}

/**
 * Write a single append-only audit log entry.
 *
 * NEVER throws — any DB error is caught and logged to console.error.
 * There is intentionally no update or delete export from this module.
 */
export async function writeAuditEntry(
	db: SiaDb,
	op: AuditOperation,
	details: AuditDetails = {},
): Promise<void> {
	try {
		await db.execute(
			`INSERT INTO audit_log (
				id, ts, operation,
				entity_id, edge_id, source_episode,
				trust_tier, extraction_method, source_hash,
				developer_id, snapshot_id
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				randomUUID(),
				Date.now(),
				op,
				details.entity_id ?? null,
				details.edge_id ?? null,
				details.source_episode ?? null,
				details.trust_tier ?? null,
				details.extraction_method ?? null,
				details.source_hash ?? null,
				details.developer_id ?? null,
				details.snapshot_id ?? null,
			],
		);
	} catch (err) {
		console.error("writeAuditEntry failed:", err);
	}
}
