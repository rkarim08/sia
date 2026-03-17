// Module: dedup — three-layer deduplication for team sync

import { wordJaccard } from "@/capture/consolidate";
import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";

export interface DedupeResult {
	merged: number;
	flagged: number;
	different: number;
}

function normalizeName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ");
}

function cosineSimilarity(a: Uint8Array | null, b: Uint8Array | null): number | null {
	if (!a || !b) return null;
	const fa = new Float32Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 4));
	const fb = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
	if (fa.length !== fb.length || fa.length === 0) return null;

	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < fa.length; i++) {
		dot += fa[i] * fb[i];
		normA += fa[i] * fa[i];
		normB += fb[i] * fb[i];
	}
	if (normA === 0 || normB === 0) return null;
	return dot / Math.sqrt(normA * normB);
}

export async function deduplicateEntities(
	db: SiaDb,
	peerEntities: Entity[],
): Promise<DedupeResult> {
	const localRows = await db.execute(
		"SELECT * FROM entities WHERE archived_at IS NULL AND t_valid_until IS NULL",
	);
	const locals = localRows.rows as Entity[];
	const now = Date.now();

	const result: DedupeResult = { merged: 0, flagged: 0, different: 0 };

	for (const peer of peerEntities) {
		const peerNorm = normalizeName(peer.name);
		const peerId = peer.created_by ?? "peer";
		for (const local of locals) {
			if (local.type !== peer.type) continue;

			const nameJaccard = wordJaccard(peerNorm, normalizeName(local.name));
			let decision: "merged" | "pending" | "different";

			if (nameJaccard > 0.95) {
				decision = "merged";
				result.merged++;
			} else {
				const cosine = cosineSimilarity(local.embedding, peer.embedding);
				if (cosine !== null && cosine > 0.92) {
					decision = "merged";
					result.merged++;
				} else if (cosine !== null && cosine >= 0.8) {
					decision = "pending";
					result.flagged++;
				} else {
					decision = "different";
					result.different++;
				}
			}

			await db.execute(
				`INSERT OR REPLACE INTO sync_dedup_log (entity_a_id, entity_b_id, peer_id, decision, checked_at)
                                 VALUES (?, ?, ?, ?, ?)`,
				[local.id, peer.id, peerId, decision, now],
			);
		}
	}

	return result;
}
