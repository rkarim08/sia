// Module: cross-encoder — Stage 3 cross-encoder reranking via ONNX inference

/** Input candidate for cross-encoder reranking. */
export interface CrossEncoderCandidate {
	entityId: string;
	text: string;
}

/** Output of cross-encoder reranking. */
export interface CrossEncoderResult {
	entityId: string;
	score: number;
}

/** Tokenizer function for cross-encoder (query + passage pair). */
export type PairTokenizer = (query: string, text: string) => {
	inputIds: BigInt64Array;
	attentionMask: BigInt64Array;
	tokenTypeIds: BigInt64Array;
};

/** Configuration for creating a cross-encoder reranker. */
export interface CrossEncoderConfig {
	session: { run(feeds: Record<string, unknown>): Promise<Record<string, unknown>> } | null;
	tokenize: PairTokenizer;
	maxSeqLength: number;
}

/** Cross-encoder reranker interface. */
export interface CrossEncoderReranker {
	rerank(query: string, candidates: CrossEncoderCandidate[]): Promise<CrossEncoderResult[]>;
}

/** Sigmoid activation: maps logit to [0, 1]. */
export function sigmoid(x: number): number {
	return 1 / (1 + Math.exp(-x));
}

/** Pad or truncate a BigInt64Array to exactly `length` elements. */
function padOrTruncate(arr: BigInt64Array, length: number): BigInt64Array {
	if (arr.length === length) return arr;
	const result = new BigInt64Array(length);
	const copyLen = Math.min(arr.length, length);
	for (let i = 0; i < copyLen; i++) result[i] = arr[i];
	return result;
}

/**
 * Create a cross-encoder reranker.
 *
 * Scores each (query, candidate_text) pair independently via the ONNX model.
 * Returns candidates sorted by score descending.
 *
 * If session is null, returns all candidates with score 0 (graceful degradation).
 */
export function createCrossEncoderReranker(config: CrossEncoderConfig): CrossEncoderReranker {
	const { session, tokenize, maxSeqLength } = config;

	return {
		async rerank(
			query: string,
			candidates: CrossEncoderCandidate[],
		): Promise<CrossEncoderResult[]> {
			if (candidates.length === 0) return [];

			if (!session) {
				// No model available — return all with zero score
				return candidates.map((c) => ({ entityId: c.entityId, score: 0 }));
			}

			const results: CrossEncoderResult[] = [];

			// Score each pair sequentially (small N, typically 10-15)
			for (const candidate of candidates) {
				try {
					const tokens = tokenize(query, candidate.text);

					// Pad or truncate to exactly maxSeqLength
					const inputIds = padOrTruncate(tokens.inputIds, maxSeqLength);
					const attentionMask = padOrTruncate(tokens.attentionMask, maxSeqLength);
					const tokenTypeIds = padOrTruncate(tokens.tokenTypeIds, maxSeqLength);

					const shape = [1, maxSeqLength] as const;
					const feeds: Record<string, unknown> = {
						input_ids: { data: inputIds, dims: shape, type: "int64" },
						attention_mask: { data: attentionMask, dims: shape, type: "int64" },
						token_type_ids: { data: tokenTypeIds, dims: shape, type: "int64" },
					};

					const output = await session.run(feeds);

					// Cross-encoders output a single logit per pair
					const logits = output.logits as { data: Float32Array; dims: readonly number[] };
					const logit = logits?.data?.[0] ?? 0;
					const score = sigmoid(logit);

					results.push({ entityId: candidate.entityId, score });
				} catch (err) {
					console.error(
						`[sia] cross-encoder: scoring failed for entity ${candidate.entityId}:`,
						err instanceof Error ? err.message : String(err),
					);
					results.push({ entityId: candidate.entityId, score: 0 });
				}
			}

			// Sort by score descending
			results.sort((a, b) => b.score - a.score);
			return results;
		},
	};
}
