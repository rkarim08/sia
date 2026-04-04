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
		tokenizerType: "wordpiece",
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
		tokenizerType: "wordpiece",
	},
	"jina-embeddings-v2-base-code": {
		huggingface: "jinaai/jina-embeddings-v2-base-code",
		file: "onnx/model_quantized.onnx",
		tokenizerFile: "tokenizer.json",
		sha256: "ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d",
		tokenizerSha256: "b01c78a902aa4facb2f47f95449f48e2f7bbfea5d2472ee2f6ce92323c6f86e5",
		sizeBytes: 161_895_621,
		tier: "T1",
		embeddingDim: 768,
		maxSeqLength: 8192,
		tokenizerType: "bpe",
	},
	"nomic-embed-text-v1.5": {
		huggingface: "nomic-ai/nomic-embed-text-v1.5",
		file: "onnx/model_quantized.onnx",
		tokenizerFile: "tokenizer.json",
		sha256: "b4342336debaea79de872370664b0aaeb67dea4605513d00ee236ea871a81f27",
		tokenizerSha256: "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
		sizeBytes: 137_296_292,
		tier: "T1",
		embeddingDim: 768,
		maxSeqLength: 8192,
		tokenizerType: "wordpiece",
	},
	"sia-attention-head": {
		huggingface: "sia-project/attention-head",
		file: "model.onnx",
		sha256: "5f8e17f5fff2cd42471b60bae85e9464d335d0bb49b1e1cd076960a558bfe942",
		sizeBytes: 208_828,
		tier: "T1",
	},
	"gliner-small-v2.1": {
		huggingface: "onnx-community/gliner_small-v2.1",
		file: "onnx/model_quantized.onnx",
		tokenizerFile: "tokenizer.json",
		sha256: "c76c90920547fd937aaf505e7f2de5ec73168bf1c25abbb55a298104cb061400",
		tokenizerSha256: "677203884d026e721115cf0daccf70ec4239545a13d6619e3e66d7151e0c9ce3",
		sizeBytes: 183_403_734,
		tier: "T2",
		maxSeqLength: 384,
		tokenizerType: "sentencepiece",
	},
	// ⚠️  DO NOT substitute mxbai-rerank-v2 here. mxbai-rerank-large-v2 is a Qwen2-0.5B
	// generative decoder (~500M params) — it is NOT a cross-encoder and has no official
	// ONNX export. v1 (bert-based cross-encoder, ~52MB ONNX) is the correct T3 model.
	"mxbai-rerank-base-v1": {
		huggingface: "mixedbread-ai/mxbai-rerank-base-v1",
		file: "onnx/model.onnx",
		tokenizerFile: "tokenizer.json",
		sha256: "acd44aff3ed526079ed44cffac2e549ce70805ea193d70973c98b67e09efec1a",
		tokenizerSha256: "305674b4d785287feecfb5f73f24aa75e9b57c87c579cfe24fbd207987d4b4c4",
		sizeBytes: 738_560_113,
		tier: "T3",
		maxSeqLength: 512,
		tokenizerType: "wordpiece",
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
