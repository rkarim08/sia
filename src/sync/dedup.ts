// Module: dedup — three-layer deduplication for team sync

import { wordJaccard } from "@/capture/consolidate";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import type { Entity } from "@/graph/entities";
import { invalidateEntity, updateEntity } from "@/graph/entities";
import type { LlmClient } from "@/shared/llm-client";

export interface DedupeResult {
	merged: number;
	flagged: number;
	different: number;
}

function normalizeName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\-_]+/g, " ");
}

export function cosineSimilarity(a: Uint8Array | null, b: Uint8Array | null): number | null {
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

/**
 * Compute the magnitude (L2 norm) of an embedding vector.
 */
function _embeddingMagnitude(e: Uint8Array | null): number | null {
	if (!e) return null;
	const f = new Float32Array(e.buffer, e.byteOffset, Math.floor(e.byteLength / 4));
	if (f.length === 0) return null;
	let sum = 0;
	for (let i = 0; i < f.length; i++) {
		sum += f[i] * f[i];
	}
	return Math.sqrt(sum);
}

/**
 * Union two JSON-encoded string arrays.
 */
function unionJsonArrays(jsonA: string, jsonB: string): string {
	let arrA: string[] = [];
	let arrB: string[] = [];
	try {
		arrA = JSON.parse(jsonA);
	} catch {
		/* empty */
	}
	try {
		arrB = JSON.parse(jsonB);
	} catch {
		/* empty */
	}
	const merged = [...new Set([...arrA, ...arrB])];
	return JSON.stringify(merged);
}

/**
 * Compute importance for a merged entity using time-decay weighted average.
 */
function mergedImportance(a: Entity, b: Entity, now: number): number {
	const ageDaysA = (now - a.created_at) / 86400000;
	const ageDaysB = (now - b.created_at) / 86400000;
	const wA = Math.exp(-0.01 * ageDaysA);
	const wB = Math.exp(-0.01 * ageDaysB);
	return (a.importance * wA + b.importance * wB) / (wA + wB);
}

export async function deduplicateEntities(
	db: SiaDb,
	peerEntities: Entity[],
	llmClient?: LlmClient,
): Promise<DedupeResult> {
	const localRows = await db.execute(
		"SELECT * FROM graph_nodes WHERE archived_at IS NULL AND t_valid_until IS NULL",
	);
	const locals = localRows.rows as unknown as Entity[];
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
			} else {
				const cosine = cosineSimilarity(local.embedding, peer.embedding);
				if (cosine !== null && cosine > 0.92) {
					decision = "merged";
				} else if (cosine !== null && cosine >= 0.8) {
					decision = "pending";
				} else {
					decision = "different";
				}
			}

			// Layer 3: LLM classification for pending pairs (0.80-0.92 range)
			if (decision === "pending" && llmClient) {
				const prompt = `Entity A: "${local.name}" — ${local.content}\nEntity B: "${peer.name}" — ${peer.content}\n\nAre these the same entity, different entities, or related entities?`;
				const classification = await llmClient.classify(prompt, ["SAME", "DIFFERENT", "RELATED"]);

				if (classification === "SAME") {
					decision = "merged";
				} else if (classification === "RELATED") {
					// Create a relates_to edge
					await insertEdge(db, {
						from_id: local.id,
						to_id: peer.id,
						type: "relates_to",
						weight: 0.6,
					});
					decision = "different";
				} else {
					decision = "different";
				}
			}

			// Merge implementation for SAME decisions
			if (decision === "merged") {
				const mergedTags = unionJsonArrays(local.tags, peer.tags);
				const mergedFilePaths = unionJsonArrays(local.file_paths, peer.file_paths);
				const newTrustTier = Math.max(local.trust_tier, peer.trust_tier);
				const newImportance = mergedImportance(local, peer, now);

				let mergedContent = local.content;
				if (llmClient) {
					mergedContent = await llmClient.summarize(
						`Synthesize a merged description from these two entity descriptions:\n1. ${local.content}\n2. ${peer.content}`,
					);
				}

				await updateEntity(db, local.id, {
					tags: mergedTags,
					file_paths: mergedFilePaths,
					trust_tier: newTrustTier,
					importance: newImportance,
					content: mergedContent,
				});

				// Invalidate the peer (losing entity)
				await invalidateEntity(db, peer.id);

				result.merged++;
			} else if (decision === "pending") {
				result.flagged++;
			} else {
				result.different++;
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
