// Module: sia-index — Index markdown/text content by chunking and scanning for entity references

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { headingChunker } from "@/sandbox/context-mode";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export const SiaIndexInput = z.object({
	content: z.string(),
	source: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

export interface SiaIndexResult {
	indexed: number;
	references: number;
	chunkIds: string[];
}

// ---------------------------------------------------------------------------
// handleSiaIndex
// ---------------------------------------------------------------------------

export async function handleSiaIndex(
	db: SiaDb,
	input: z.infer<typeof SiaIndexInput>,
	_embedder: Embedder | null,
	sessionId: string,
): Promise<SiaIndexResult> {
	const { content, source, tags } = input;

	// 1. Empty content fast-path
	if (!content || content.trim().length === 0) {
		return { indexed: 0, references: 0, chunkIds: [] };
	}

	const now = Date.now();
	const nowStr = String(now);
	const tagsJson = JSON.stringify(tags ?? []);

	// 2. Chunk content via headingChunker
	const rawChunks = headingChunker.chunk(content);

	// 3. Embed each chunk and store as ContentChunk node in graph_nodes
	const chunkIds: string[] = [];

	for (let i = 0; i < rawChunks.length; i++) {
		const raw = rawChunks[i];
		const nodeId = randomUUID();
		const chunkName = source ? `chunk-${source}-${i}` : `chunk-${sessionId}-${i}`;
		const summary = raw.text.slice(0, 100);

		await db.execute(
			`INSERT INTO graph_nodes (id, type, name, summary, content, trust_tier, confidence, base_confidence, importance, base_importance, access_count, edge_count, tags, file_paths, t_created, t_valid_from, created_by, created_at, last_accessed)
			 VALUES (?, 'ContentChunk', ?, ?, ?, 3, 0.8, 0.8, 0.5, 0.5, 0, 0, ?, '[]', ?, ?, 'sia-index', ?, ?)`,
			[nodeId, chunkName, summary, raw.text, tagsJson, nowStr, nowStr, nowStr, nowStr],
		);

		chunkIds.push(nodeId);
	}

	// 4. Scan each chunk for mentions of known entity names
	//    Query graph_nodes for CodeSymbol and FileNode types
	const { rows: knownEntities } = await db.execute(
		`SELECT id, name FROM graph_nodes WHERE type IN ('CodeSymbol', 'FileNode') AND (t_expired IS NULL OR t_expired = '') AND (t_valid_until IS NULL OR t_valid_until = '')`,
		[],
	);

	let referenceCount = 0;

	if (knownEntities.length > 0) {
		for (let ci = 0; ci < rawChunks.length; ci++) {
			const chunkText = rawChunks[ci].text;
			const chunkNodeId = chunkIds[ci];

			for (const row of knownEntities) {
				const entityId = row.id as string;
				const entityName = row.name as string;
				if (entityName && chunkText.includes(entityName)) {
					try {
						await insertEdge(db, {
							from_id: chunkNodeId,
							to_id: entityId,
							type: "references",
							weight: 1.0,
							confidence: 0.7,
							trust_tier: 3,
						});
						referenceCount++;
					} catch (edgeErr) {
						console.error(
							`[sia-index] edge insert failed for ${chunkNodeId}->${entityId}: ${(edgeErr as Error).message}`,
						);
					}
				}
			}
		}
	}

	return {
		indexed: chunkIds.length,
		references: referenceCount,
		chunkIds,
	};
}
