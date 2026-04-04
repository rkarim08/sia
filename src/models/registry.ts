// Module: models/registry — bundled model source registry with tier assignments
import { type ModelTier, type RegistryEntry, TIER_ORDER } from "@/models/types";

/**
 * Bundled registry of all downloadable models.
 * SHA-256 checksums are verified before first use.
 * Checksums are placeholders — replace with actual values after downloading each model.
 */
export const MODEL_REGISTRY: Record<string, RegistryEntry> = {
	"bge-small-en-v1.5": {
		huggingface: "Xenova/bge-small-en-v1.5",
		file: "onnx/model_quantized.onnx",
		tokenizerFile: "tokenizer.json",
		sha256: "6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4",
		tokenizerSha256: "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
		sizeBytes: 34_014_426,
		tier: "T0",
		embeddingDim: 384,
		maxSeqLength: 512,
	},
	"ms-marco-MiniLM-L-6-v2": {
		huggingface: "Xenova/ms-marco-MiniLM-L-6-v2",
		file: "onnx/model_quantized.onnx",
		tokenizerFile: "tokenizer.json",
		sha256: "e9d8ebf845c413e981c175bfe49a3bfa9b3dcce2a3ba54875ee5df5a58639fbe",
		tokenizerSha256: "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
		sizeBytes: 23_143_499,
		tier: "T0",
		maxSeqLength: 512,
	},
	"jina-embeddings-v2-base-code": {
		huggingface: "jinaai/jina-embeddings-v2-base-code",
		file: "onnx/model_quantized.onnx",
		tokenizerFile: "tokenizer.json",
		sha256: "PLACEHOLDER_JINA_CODE_SHA256",
		tokenizerSha256: "PLACEHOLDER_JINA_CODE_TOK_SHA256",
		sizeBytes: 83_886_080,
		tier: "T1",
		embeddingDim: 768,
		maxSeqLength: 8192,
	},
	"nomic-embed-text-v1.5": {
		huggingface: "nomic-ai/nomic-embed-text-v1.5",
		file: "onnx/model_quantized.onnx",
		tokenizerFile: "tokenizer.json",
		sha256: "PLACEHOLDER_NOMIC_SHA256",
		tokenizerSha256: "PLACEHOLDER_NOMIC_TOK_SHA256",
		sizeBytes: 68_157_440,
		tier: "T1",
		embeddingDim: 768,
		maxSeqLength: 8192,
	},
	"sia-attention-head": {
		huggingface: "sia-project/attention-head",
		file: "model.onnx",
		sha256: "5f8e17f5fff2cd42471b60bae85e9464d335d0bb49b1e1cd076960a558bfe942",
		sizeBytes: 208_828,
		tier: "T1",
	},
	"gliner-small-v2.1": {
		huggingface: "urchade/gliner_small-v2.1",
		file: "onnx/model_quantized.onnx",
		tokenizerFile: "tokenizer.json",
		sha256: "PLACEHOLDER_GLINER_SHA256",
		tokenizerSha256: "PLACEHOLDER_GLINER_TOK_SHA256",
		sizeBytes: 197_132_288,
		tier: "T2",
		maxSeqLength: 384,
	},
	// ⚠️  DO NOT substitute mxbai-rerank-v2 here. mxbai-rerank-large-v2 is a Qwen2-0.5B
	// generative decoder (~500M params) — it is NOT a cross-encoder and has no official
	// ONNX export. v1 (bert-based cross-encoder, ~52MB ONNX) is the correct T3 model.
	"mxbai-rerank-base-v1": {
		huggingface: "mixedbread-ai/mxbai-rerank-base-v1",
		file: "onnx/model.onnx",
		tokenizerFile: "tokenizer.json",
		sha256: "PLACEHOLDER_MXBAI_SHA256",
		tokenizerSha256: "PLACEHOLDER_MXBAI_TOK_SHA256",
		sizeBytes: 52_428_800,
		tier: "T3",
		maxSeqLength: 512,
	},
};

/**
 * Return all models required for a given tier (inclusive of lower tiers).
 */
export function getModelsForTier(tier: ModelTier): Record<string, RegistryEntry> {
	const targetOrder = TIER_ORDER[tier];
	const result: Record<string, RegistryEntry> = {};
	for (const [name, entry] of Object.entries(MODEL_REGISTRY)) {
		if (TIER_ORDER[entry.tier] <= targetOrder) {
			result[name] = entry;
		}
	}
	return result;
}

/**
 * Return models that need to be downloaded when upgrading from one tier to another.
 */
export function getModelsToDownload(
	fromTier: ModelTier,
	toTier: ModelTier,
): Record<string, RegistryEntry> {
	const fromOrder = TIER_ORDER[fromTier];
	const toOrder = TIER_ORDER[toTier];
	if (toOrder <= fromOrder) return {};

	const result: Record<string, RegistryEntry> = {};
	for (const [name, entry] of Object.entries(MODEL_REGISTRY)) {
		const entryOrder = TIER_ORDER[entry.tier];
		if (entryOrder > fromOrder && entryOrder <= toOrder) {
			result[name] = entry;
		}
	}
	return result;
}

/**
 * Return models that should be removed when downgrading from one tier to another.
 */
export function getModelsToRemove(
	fromTier: ModelTier,
	toTier: ModelTier,
): string[] {
	const fromOrder = TIER_ORDER[fromTier];
	const toOrder = TIER_ORDER[toTier];
	if (toOrder >= fromOrder) return [];

	const result: string[] = [];
	for (const [name, entry] of Object.entries(MODEL_REGISTRY)) {
		const entryOrder = TIER_ORDER[entry.tier];
		if (entryOrder > toOrder && entryOrder <= fromOrder) {
			result.push(name);
		}
	}
	return result;
}
