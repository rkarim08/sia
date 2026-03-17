// Module: embedder — ONNX-based text embedding with lazy session initialization

import { existsSync } from "node:fs";
import type { Tokenizer } from "@/capture/tokenizer";
import { loadTokenizer, tokenize } from "@/capture/tokenizer";

/** Embedding vector dimension for all-MiniLM-L6-v2. */
const EMBEDDING_DIM = 384;

/** Maximum sequence length for tokenization. */
const MAX_SEQ_LENGTH = 128;

/**
 * The Embedder interface: embed text into a float vector, and clean up resources.
 */
export interface Embedder {
	embed(text: string): Promise<Float32Array | null>;
	close(): void;
}

/**
 * Try to load the onnxruntime-node module.
 * Returns null if the module is unavailable (e.g., unsupported platform).
 */
async function loadOnnxRuntime(): Promise<typeof import("onnxruntime-node") | null> {
	try {
		return await import("onnxruntime-node");
	} catch {
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
	let session: { run(feeds: Record<string, unknown>): Promise<Record<string, unknown>> } | null =
		null;
	let tokenizer: Tokenizer | null = null;
	let initialized = false;
	let ort: typeof import("onnxruntime-node") | null = null;

	async function ensureSession(): Promise<boolean> {
		if (initialized) return session !== null;
		initialized = true;

		if (!existsSync(modelPath)) {
			return false;
		}

		if (!existsSync(tokenizerPath)) {
			return false;
		}

		try {
			tokenizer = loadTokenizer(tokenizerPath);
		} catch {
			return false;
		}

		try {
			ort = await loadOnnxRuntime();
			if (!ort) return false;

			session = (await ort.InferenceSession.create(modelPath, {
				executionProviders: ["cpu"],
			})) as unknown as typeof session;
			return true;
		} catch {
			session = null;
			return false;
		}
	}

	return {
		async embed(text: string): Promise<Float32Array | null> {
			const ready = await ensureSession();
			if (!ready || !session || !tokenizer || !ort) return null;

			const { inputIds, attentionMask } = tokenize(tokenizer, text, MAX_SEQ_LENGTH);

			// Build token_type_ids (all zeros for single-sentence tasks)
			const tokenTypeIds = new BigInt64Array(MAX_SEQ_LENGTH);

			// Create ONNX tensors — shape [1, MAX_SEQ_LENGTH]
			const shape = [1, MAX_SEQ_LENGTH] as const;
			const feeds = {
				input_ids: new ort.Tensor("int64", inputIds, shape),
				attention_mask: new ort.Tensor("int64", attentionMask, shape),
				token_type_ids: new ort.Tensor("int64", tokenTypeIds, shape),
			};

			const results = await session.run(feeds);

			// last_hidden_state has shape [1, seq_len, 384]
			const lastHiddenState = results.last_hidden_state as {
				data: Float32Array;
				dims: readonly number[];
			};
			if (!lastHiddenState?.data) return null;

			const hiddenData = lastHiddenState.data;
			const seqLen = lastHiddenState.dims[1] ?? MAX_SEQ_LENGTH;

			// Mean pooling: average only non-padding token vectors
			return meanPoolAndNormalize(hiddenData, attentionMask, seqLen, EMBEDDING_DIM);
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
