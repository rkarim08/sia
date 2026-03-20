// Module: context-mode — Large output chunking with intent-based retrieval using strategy pattern

import { randomUUID } from "node:crypto";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface RawChunk {
	text: string;
	metadata?: Record<string, unknown>;
}

export interface StoredChunk {
	id: string;
	text: string;
	embedding: number[];
	nodeId: string; // ContentChunk entity ID in graph
}

export interface ChunkStrategy {
	name: string;
	chunk(content: string): RawChunk[];
	extraEdges?(chunk: StoredChunk, db: SiaDb): Promise<void>;
}

export interface ContextModeResult {
	applied: boolean;
	chunks: string[];
	totalIndexed: number;
	contextSavings: number;
}

// ---------------------------------------------------------------------------
// lineChunker strategy — groups newline-delimited lines into ~512-token (~2048 char) paragraphs
// ---------------------------------------------------------------------------

const LINE_CHUNK_SIZE = 2048;

export const lineChunker: ChunkStrategy = {
	name: "lineChunker",

	chunk(content: string): RawChunk[] {
		const lines = content.split("\n");
		const chunks: RawChunk[] = [];
		let current = "";
		let startLine = 0;
		let currentStart = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const candidate = current.length === 0 ? line : `${current}\n${line}`;

			if (candidate.length > LINE_CHUNK_SIZE && current.length > 0) {
				chunks.push({
					text: current,
					metadata: { startLine: currentStart, endLine: i - 1 },
				});
				current = line;
				currentStart = i;
				startLine = i;
			} else {
				current = candidate;
			}
		}

		if (current.length > 0) {
			chunks.push({
				text: current,
				metadata: { startLine: currentStart, endLine: lines.length - 1 },
			});
		}

		return chunks;
	},
};

// ---------------------------------------------------------------------------
// Cosine similarity between two number arrays
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// applyContextMode — main entry point
// ---------------------------------------------------------------------------

/**
 * Apply context mode to a large content string.
 *
 * If content.length <= threshold OR intent is undefined, returns raw content unchanged.
 * Otherwise, chunks the content via the strategy, embeds each chunk into the graph DB
 * as ContentChunk entities, embeds the intent, and returns the top-K chunks by
 * cosine similarity to the intent embedding.
 */
export async function applyContextMode(
	content: string,
	intent: string | undefined,
	strategy: ChunkStrategy,
	db: SiaDb,
	embedder: Embedder,
	sessionId: string,
	config: { threshold: number; topK: number },
): Promise<ContextModeResult> {
	// Short-circuit: below threshold or no intent
	if (content.length <= config.threshold || intent === undefined) {
		return {
			applied: false,
			chunks: [content],
			totalIndexed: 0,
			contextSavings: 0,
		};
	}

	const now = Date.now();
	const nowStr = String(now);

	// 1. Chunk content via strategy
	const rawChunks = strategy.chunk(content);

	// 2. Embed each chunk and store as ContentChunk entity in the graph
	const storedChunks: StoredChunk[] = [];

	for (let i = 0; i < rawChunks.length; i++) {
		const raw = rawChunks[i];
		const nodeId = randomUUID();
		const chunkName = `chunk-${sessionId}-${i}`;

		// Embed the chunk text
		const rawEmb = await embedder.embed(raw.text);
		const embedding: number[] = rawEmb ? Array.from(rawEmb) : [];

		// Store entity in graph DB (table is 'graph_nodes' after v5 migration)
		await db.execute(
			`INSERT INTO graph_nodes (id, type, name, summary, content, trust_tier, confidence, base_confidence, importance, base_importance, access_count, edge_count, tags, file_paths, t_created, t_valid_from, created_by, created_at, last_accessed)
			 VALUES (?, 'ContentChunk', ?, ?, ?, 3, 0.8, 0.8, 0.5, 0.5, 0, 0, '[]', '[]', ?, ?, 'sia-context-mode', ?, ?)`,
			[nodeId, chunkName, raw.text.slice(0, 100), raw.text, nowStr, nowStr, nowStr, nowStr],
		);

		const stored: StoredChunk = {
			id: randomUUID(),
			text: raw.text,
			embedding,
			nodeId,
		};

		storedChunks.push(stored);

		// Call extraEdges if defined
		if (strategy.extraEdges) {
			await strategy.extraEdges(stored, db);
		}
	}

	// 3. Embed the intent
	const intentEmbRaw = await embedder.embed(intent);
	const intentEmbedding: number[] = intentEmbRaw ? Array.from(intentEmbRaw) : [];

	// 4. Cosine similarity between intent embedding and each stored chunk embedding
	const scored = storedChunks.map((chunk) => ({
		chunk,
		score: cosineSimilarity(intentEmbedding, chunk.embedding),
	}));

	// Sort by similarity descending, take top-K
	scored.sort((a, b) => b.score - a.score);
	const topChunks = scored.slice(0, config.topK).map((s) => s.chunk.text);

	const totalIndexed = storedChunks.length;
	const contextSavings = content.length - topChunks.reduce((sum, c) => sum + c.length, 0);

	return {
		applied: true,
		chunks: topChunks,
		totalIndexed,
		contextSavings: Math.max(0, contextSavings),
	};
}
