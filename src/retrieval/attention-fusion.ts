// Module: attention-fusion — Stage 4 SIA Attention Fusion Head
//
// Architecture (from spec):
// - Input: per-candidate feature vector (405d)
// - Input projection: Linear(405 → 128) + LayerNorm
// - Self-Attention Block 1: 4-head MHA + QKNorm + Graphormer spatial bias + GeGLU FFN
// - Self-Attention Block 2: 4-head MHA + QKNorm + Graphormer spatial bias + GeGLU FFN
// - Output: Linear(128 → 1) per entity → sigmoid
//
// At T0 (no attention head ONNX model), falls back to RRF.
// At T1+, runs the ONNX attention fusion model.

import { createDefaultTime2VecParams, time2vecEncode, TIME2VEC_DIM } from "@/retrieval/time2vec";

/** Per-candidate features assembled before fusion. */
export interface CandidateFeatures {
	entityId: string;
	bm25Score: number;
	vectorScore: number;
	graphScore: number;
	crossEncoderScore: number;
	trustTierWeight: number;
	entityEmbedding: Float32Array; // 384d from bge-small
	daysSinceCapture: number;
	graphHopDistance: number;
	/** Optional second vector score from jina-code (T1+). */
	codeVectorScore?: number;
}

/** Result after attention fusion or RRF fallback. */
export interface FusionResult {
	entityId: string;
	score: number;
}

/** Feature vector dimension: 4 scores + 1 trust + 384 embedding + 16 time2vec = 405. */
export const FEATURE_DIM = 405;
/** Feature vector dimension with code score (T1+): 406. */
export const FEATURE_DIM_T1 = 406;

/**
 * Assemble a feature vector for one candidate entity.
 *
 * Layout (405 floats):
 *   [0]     BM25 score
 *   [1]     Vector similarity score
 *   [2]     Graph traversal score
 *   [3]     Cross-encoder score
 *   [4]     Trust tier weight
 *   [5-388] Entity embedding (384d)
 *   [389-404] Time2Vec temporal encoding (16d)
 *
 * If codeVectorScore is provided (T1+), appended as [405] making it 406d.
 */
export function assembleFeatureVector(candidate: CandidateFeatures): Float32Array {
	const hasCodeScore = candidate.codeVectorScore !== undefined;
	const dim = hasCodeScore ? FEATURE_DIM_T1 : FEATURE_DIM;
	const vec = new Float32Array(dim);

	// Retrieval scores (indices 0-3)
	vec[0] = candidate.bm25Score;
	vec[1] = candidate.vectorScore;
	vec[2] = candidate.graphScore;
	vec[3] = candidate.crossEncoderScore;

	// Trust tier weight (index 4)
	vec[4] = candidate.trustTierWeight;

	// Entity embedding (indices 5-388)
	const emb = candidate.entityEmbedding;
	for (let i = 0; i < Math.min(emb.length, 384); i++) {
		vec[5 + i] = emb[i];
	}

	// Time2Vec temporal encoding (indices 389-404)
	const logDays = Math.log2(1 + candidate.daysSinceCapture);
	const t2vParams = createDefaultTime2VecParams();
	const temporal = time2vecEncode(logDays, t2vParams);
	for (let i = 0; i < TIME2VEC_DIM; i++) {
		vec[389 + i] = temporal[i];
	}

	// Optional code vector score (index 405)
	if (hasCodeScore) {
		vec[405] = candidate.codeVectorScore!;
	}

	return vec;
}

/**
 * RRF fallback fusion (used at T0 when no attention head is available).
 *
 * Computes a weighted combination of the 4 retrieval scores:
 *   score = 0.3*bm25 + 0.25*vector + 0.2*graph + 0.25*crossEncoder
 *   final = score * trustWeight
 *
 * Weights derived from Vespa research: BM25-weighted RRF dominates zero-shot.
 */
export function rrfFallback(candidates: CandidateFeatures[]): FusionResult[] {
	if (candidates.length === 0) return [];

	const results: FusionResult[] = candidates.map((c) => {
		const score =
			0.3 * c.bm25Score +
			0.25 * c.vectorScore +
			0.2 * c.graphScore +
			0.25 * c.crossEncoderScore;
		return {
			entityId: c.entityId,
			score: score * c.trustTierWeight,
		};
	});

	results.sort((a, b) => b.score - a.score);
	return results;
}

/**
 * Run the attention fusion head via ONNX inference.
 *
 * Takes assembled feature vectors for all candidates + optional code context,
 * runs the 2-layer 4-head transformer, returns relevance scores.
 *
 * If the ONNX session is null, falls back to rrfFallback.
 *
 * @param candidates - Feature vectors for each candidate entity
 * @param graphDistances - Pairwise graph hop distances between candidates (for Graphormer bias)
 * @param codeContextEmbedding - Optional code context embedding for [CODE_CTX] token
 * @param session - ONNX InferenceSession for the attention head model (null = fallback)
 */
export async function attentionFusion(
	candidates: CandidateFeatures[],
	graphDistances: number[][],
	codeContextEmbedding: Float32Array | null,
	session: { run(feeds: Record<string, unknown>): Promise<Record<string, unknown>> } | null,
): Promise<FusionResult[]> {
	if (candidates.length === 0) return [];

	// Fallback to RRF when no model is available
	if (!session) {
		return rrfFallback(candidates);
	}

	// Assemble feature matrix: [K, FEATURE_DIM]
	const K = candidates.length;
	const featureDim = candidates[0].codeVectorScore !== undefined ? FEATURE_DIM_T1 : FEATURE_DIM;

	const features = new Float32Array(K * featureDim);
	for (let i = 0; i < K; i++) {
		const vec = assembleFeatureVector(candidates[i]);
		features.set(vec, i * featureDim);
	}

	// Flatten graph distances: [K, K]
	const distMatrix = new Float32Array(K * K);
	for (let i = 0; i < K; i++) {
		for (let j = 0; j < K; j++) {
			distMatrix[i * K + j] = graphDistances[i]?.[j] ?? 0;
		}
	}

	const hasCodeCtx = codeContextEmbedding !== null;

	try {
		const feeds: Record<string, unknown> = {
			features: { data: features, dims: [K, featureDim], type: "float32" },
			graph_distances: { data: distMatrix, dims: [K, K], type: "float32" },
			has_code_context: { data: new Float32Array([hasCodeCtx ? 1.0 : 0.0]), dims: [1], type: "float32" },
		};

		if (hasCodeCtx && codeContextEmbedding) {
			feeds.code_context = {
				data: codeContextEmbedding,
				dims: [1, codeContextEmbedding.length],
				type: "float32",
			};
		}

		const output = await session.run(feeds);
		const scores = output.scores as { data: Float32Array; dims: readonly number[] };

		if (!scores?.data) {
			return rrfFallback(candidates);
		}

		const results: FusionResult[] = [];
		for (let i = 0; i < K; i++) {
			results.push({
				entityId: candidates[i].entityId,
				score: scores.data[i] ?? 0,
			});
		}

		results.sort((a, b) => b.score - a.score);
		return results;
	} catch {
		// On any ONNX error, fall back to RRF
		return rrfFallback(candidates);
	}
}
