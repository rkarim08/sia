// Module: capture/embed-entity — shared utility for embedding entities into graph_nodes.
// Used by consolidation, sia_note, sia_index, sia_flag, reindex.

import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";

interface EmbeddableEntity {
	id: string;
	name: string;
	summary: string | null;
	content: string | null;
}

/**
 * Embed a single entity and persist the embedding to graph_nodes.
 * No-op if embedder is null.
 */
export async function embedEntity(
	db: SiaDb,
	embedder: Embedder | null,
	entity: EmbeddableEntity,
	column: "embedding" | "embedding_code" = "embedding",
	maxLen = 512,
): Promise<void> {
	if (!embedder) return;
	if (column !== "embedding" && column !== "embedding_code") {
		throw new Error(`[sia] embedEntity: invalid column "${column}"`);
	}

	const text = `${entity.name} ${entity.summary ?? ""} ${entity.content ?? ""}`.slice(0, maxLen);
	const vec = await embedder.embed(text);
	if (!vec) return;

	await db.execute(
		`UPDATE graph_nodes SET ${column} = ? WHERE id = ?`,
		[Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength), entity.id],
	);
}

/**
 * Batch-embed entities. Used by reindex and sia learn Phase 4.5.
 */
export async function embedEntitiesBatch(
	db: SiaDb,
	embedder: Embedder,
	entities: EmbeddableEntity[],
	column: "embedding" | "embedding_code" = "embedding",
	maxLen = 512,
	batchSize = 16,
): Promise<number> {
	let embedded = 0;
	let totalAttempted = 0;
	for (let i = 0; i < entities.length; i += batchSize) {
		const batch = entities.slice(i, i + batchSize);
		totalAttempted += batch.length;
		const texts = batch.map((e) =>
			`${e.name} ${e.summary ?? ""} ${e.content ?? ""}`.slice(0, maxLen),
		);
		const embeddings = await embedder.embedBatch(texts);
		for (let j = 0; j < batch.length; j++) {
			if (embeddings[j]) {
				await db.execute(
					`UPDATE graph_nodes SET ${column} = ? WHERE id = ?`,
					[Buffer.from(embeddings[j]!.buffer, embeddings[j]!.byteOffset, embeddings[j]!.byteLength), batch[j].id],
				);
				embedded++;
			}
		}
	}
	if (totalAttempted > 0 && embedded === 0) {
		console.warn(`[sia] embedEntitiesBatch: 0/${totalAttempted} entities embedded — embedder may be non-functional`);
	}
	return embedded;
}
