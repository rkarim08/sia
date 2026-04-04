// Module: embedder — ONNX-based text embedding with lazy session initialization

import { existsSync } from "node:fs";
import type { Tokenizer } from "@/capture/tokenizer";
import { loadTokenizer, tokenize } from "@/capture/tokenizer";
import type { OnnxSession } from "@/models/types";

/** Embedding vector dimension for all-MiniLM-L6-v2. */
const EMBEDDING_DIM = 384;

/** Maximum sequence length for tokenization. */
const MAX_SEQ_LENGTH = 128;

/**
 * The Embedder interface: embed text into a float vector, and clean up resources.
 */
export interface Embedder {
	embed(text: string, trustTier?: number): Promise<Float32Array | null>;
	embedBatch(texts: string[]): Promise<(Float32Array | null)[]>;
	close(): void;
}

/**
 * Try to load the onnxruntime-node module.
 * Returns null if the module is unavailable (e.g., unsupported platform).
 */
async function loadOnnxRuntime(): Promise<typeof import("onnxruntime-node") | null> {
	try {
		return await import("onnxruntime-node");
	} catch (err) {
		if (err instanceof Error && (err.message.includes("Cannot find module") || err.message.includes("MODULE_NOT_FOUND"))) {
			console.debug("[sia] embedder: onnxruntime-node not installed — embedding disabled");
		} else {
			console.error("[sia] embedder: unexpected error loading onnxruntime-node:", err instanceof Error ? err.message : String(err));
		}
		return null;
	}
}

/**
 * Create an Embedder backed by an ONNX InferenceSession.
 *
 * The session is lazily initialized on the first call to embed().
 * If the model file does not exist or ONNX runtime is unavailable, embed() returns null.
 */
export function createEmbedder(modelPath: string, tokenizerPath: string): Embedder {
	return createMultiModelEmbedder({
		modelName: "all-MiniLM-L6-v2",
		modelPath,
		tokenizerPath,
		embeddingDim: EMBEDDING_DIM,
		maxSeqLength: MAX_SEQ_LENGTH,
	});
}

/** Configuration for a named model embedder. */
export interface MultiModelEmbedderConfig {
	modelName: string;
	modelPath: string;
	tokenizerPath: string;
	embeddingDim: number;
	maxSeqLength: number;
}

/** Extended Embedder with model metadata. */
export interface NamedEmbedder extends Embedder {
	readonly modelName: string;
	readonly embeddingDim: number;
}

/**
 * Create a named embedder with configurable model, dimensions, and sequence length.
 * Same lazy ONNX loading as createEmbedder, but parameterized for multi-model use.
 */
export function createMultiModelEmbedder(config: MultiModelEmbedderConfig): NamedEmbedder {
	const { modelName, modelPath, tokenizerPath, embeddingDim, maxSeqLength } = config;

	let session: OnnxSession | null = null;
	let tokenizer: Tokenizer | null = null;
	let initialized = false;
	let ort: typeof import("onnxruntime-node") | null = null;

	async function ensureSession(): Promise<boolean> {
		if (initialized) return session !== null;
		initialized = true;

		if (!existsSync(modelPath)) {
			console.error(`[sia] embedder(${modelName}): model file not found at ${modelPath} — run \`sia download-model\` to install`);
			return false;
		}
		if (!existsSync(tokenizerPath)) {
			console.error(`[sia] embedder(${modelName}): tokenizer file not found at ${tokenizerPath} — run \`sia download-model\` to install`);
			return false;
		}

		try {
			tokenizer = loadTokenizer(tokenizerPath);
		} catch (err) {
			console.error(`[sia] embedder(${modelName}): failed to load tokenizer from ${tokenizerPath}:`, err instanceof Error ? err.message : String(err));
			return false;
		}

		try {
			ort = await loadOnnxRuntime();
			if (!ort) return false;

			session = (await ort.InferenceSession.create(modelPath, {
				executionProviders: ["cpu"],
			})) as unknown as typeof session;
			return true;
		} catch (err) {
			console.error(`[sia] embedder(${modelName}): failed to create ONNX session from ${modelPath}:`, err instanceof Error ? err.message : String(err));
			session = null;
			return false;
		}
	}

	return {
		modelName,
		embeddingDim,

		async embed(text: string): Promise<Float32Array | null> {
			const ready = await ensureSession();
			if (!ready || !session || !tokenizer || !ort) return null;

			const { inputIds, attentionMask } = tokenize(tokenizer, text, maxSeqLength);
			const tokenTypeIds = new BigInt64Array(maxSeqLength);

			const shape = [1, maxSeqLength] as const;
			const feeds = {
				input_ids: new ort.Tensor("int64", inputIds, shape),
				attention_mask: new ort.Tensor("int64", attentionMask, shape),
				token_type_ids: new ort.Tensor("int64", tokenTypeIds, shape),
			};

			const results = await session.run(feeds);
			const lastHiddenState = results.last_hidden_state as {
				data: Float32Array;
				dims: readonly number[];
			};
			if (!lastHiddenState?.data) {
				console.error(`[sia] embedder(${modelName}): ONNX output missing 'last_hidden_state' tensor — model file may be corrupt`);
				return null;
			}

			return meanPoolAndNormalize(
				lastHiddenState.data,
				attentionMask,
				lastHiddenState.dims[1] ?? maxSeqLength,
				embeddingDim,
			);
		},

		async embedBatch(texts: string[]): Promise<(Float32Array | null)[]> {
			const results: (Float32Array | null)[] = [];
			for (let i = 0; i < texts.length; i += 16) {
				const batch = texts.slice(i, i + 16);
				const batchResults = await Promise.all(
					batch.map(async (t) => {
						try {
							return await this.embed(t);
						} catch (err) {
							console.error("[sia] embedder: embedBatch individual embed failed:", err instanceof Error ? err.message : String(err));
							return null;
						}
					}),
				);
				results.push(...batchResults);
			}
			return results;
		},

		close(): void {
			if (session && "release" in session) {
				(session as { release(): void }).release();
			}
			session = null;
			tokenizer = null;
			ort = null;
			initialized = false;
		},
	};
}

/**
 * Mean-pool the hidden states for non-padding tokens, then L2-normalize.
 */
function meanPoolAndNormalize(
	hiddenData: Float32Array,
	attentionMask: BigInt64Array,
	seqLen: number,
	dim: number,
): Float32Array {
	const pooled = new Float32Array(dim);
	let tokenCount = 0;

	for (let t = 0; t < seqLen; t++) {
		if (attentionMask[t] === 0n) continue;
		tokenCount++;
		const offset = t * dim;
		for (let d = 0; d < dim; d++) {
			pooled[d] += hiddenData[offset + d];
		}
	}

	// Average
	if (tokenCount > 0) {
		for (let d = 0; d < dim; d++) {
			pooled[d] /= tokenCount;
		}
	}

	// L2 normalize
	let norm = 0;
	for (let d = 0; d < dim; d++) {
		norm += pooled[d] * pooled[d];
	}
	norm = Math.sqrt(norm);

	if (norm > 0) {
		for (let d = 0; d < dim; d++) {
			pooled[d] /= norm;
		}
	}

	return pooled;
}
