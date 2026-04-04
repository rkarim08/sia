// Module: models/types — shared types for the transformer model stack

/** Model tier levels. */
export type ModelTier = "T0" | "T1" | "T2" | "T3";

/** A single model entry in the manifest. */
export interface ModelEntry {
	version: string;
	variant: "int8" | "fp16" | "fp32";
	sha256: string;
	sizeBytes: number;
	source: string;
	installedAt: string;
	tier: ModelTier;
}

/** Attention head training metadata. */
export interface AttentionHeadMeta {
	trainingPhase: "none" | "rrf" | "distillation" | "implicit" | "online";
	feedbackEvents: number;
	lastTrained: string | null;
	projectVariants: Record<string, string>;
}

/** The manifest.json schema. */
export interface ModelManifest {
	schemaVersion: number;
	installedTier: ModelTier;
	models: Record<string, ModelEntry>;
	attentionHead: AttentionHeadMeta;
}

/** A registry entry for a downloadable model. */
export interface RegistryEntry {
	huggingface: string;
	file: string;
	tokenizerFile?: string;
	sha256: string;
	tokenizerSha256?: string;
	sizeBytes: number;
	tier: ModelTier;
	embeddingDim?: number;
	maxSeqLength?: number;
}

/** Tier ordering for comparisons. */
export const TIER_ORDER: Record<ModelTier, number> = {
	T0: 0,
	T1: 1,
	T2: 2,
	T3: 3,
};

/** Training phase ordering for comparisons. */
export const TRAINING_PHASE_ORDER: Record<AttentionHeadMeta["trainingPhase"], number> = {
	none: 0,
	rrf: 1,
	distillation: 2,
	implicit: 3,
	online: 4,
};

/** Shared ONNX session interface — used by cross-encoder, attention-fusion, GLiNER, embedder, and server. */
export type OnnxSession = { run(feeds: Record<string, unknown>): Promise<Record<string, unknown>> };

/** Default empty manifest for fresh installs. */
export function createEmptyManifest(): ModelManifest {
	return {
		schemaVersion: 1,
		installedTier: "T0",
		models: {},
		attentionHead: {
			trainingPhase: "none",
			feedbackEvents: 0,
			lastTrained: null,
			projectVariants: {},
		},
	};
}
