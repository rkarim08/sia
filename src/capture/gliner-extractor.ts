// Module: gliner-extractor — GLiNER zero-shot NER with SIA-specific entity labels.
//
// Reference: Zaratiana et al., 2023 — "GLiNER: Generalist Model for NER"
// https://arxiv.org/abs/2311.08526
//
// At T2+, this supplements the LLM capture pipeline:
// - High confidence → accepted directly into the graph
// - Mid confidence → sent to Haiku for confirmation
// - Low confidence → rejected

/** SIA-specific entity labels for zero-shot NER. */
export const SIA_ENTITY_LABELS = [
	"Decision",
	"Convention",
	"Bug",
	"Solution",
	"Pattern",
	"FilePath",
	"FunctionName",
	"Dependency",
	"API",
	"Constraint",
] as const;

export type SiaEntityLabel = (typeof SIA_ENTITY_LABELS)[number];

/**
 * Per-label auto-accept confidence thresholds.
 *
 * Structural labels (FilePath, FunctionName) have lower thresholds because
 * they are high-precision pattern matches. Semantic labels (Decision,
 * Convention) require more contextual certainty to prevent noise.
 */
export const CONFIDENCE_THRESHOLDS: Record<SiaEntityLabel, number> = {
	FilePath: 0.6,
	FunctionName: 0.6,
	Dependency: 0.65,
	API: 0.7,
	Bug: 0.75,
	Solution: 0.75,
	Pattern: 0.8,
	Constraint: 0.8,
	Decision: 0.85,
	Convention: 0.85,
};

/** Minimum confidence below which results are rejected outright. */
const REJECT_THRESHOLD = 0.3;

/** A span extracted by GLiNER. */
export interface GlinerSpan {
	text: string;
	label: SiaEntityLabel;
	score: number;
	start: number;
	end: number;
}

/** Classification of an extraction result. */
export type ExtractionClassification = "accept" | "confirm" | "reject";

/**
 * Classify a GLiNER extraction result based on per-label confidence thresholds.
 *
 * - "accept": score >= label threshold → insert directly into graph
 * - "confirm": score >= REJECT_THRESHOLD but < label threshold → send to LLM for confirmation
 * - "reject": score < REJECT_THRESHOLD → discard
 */
export function classifyExtractionResult(span: GlinerSpan): ExtractionClassification {
	const threshold = CONFIDENCE_THRESHOLDS[span.label];

	if (span.score >= threshold) return "accept";
	if (span.score >= REJECT_THRESHOLD) return "confirm";
	return "reject";
}

/** Configuration for the GLiNER extractor. */
export interface GlinerExtractorConfig {
	session: { run(feeds: Record<string, unknown>): Promise<Record<string, unknown>> } | null;
	maxChunkLength: number;
}

/** GLiNER extractor interface. */
export interface GlinerExtractor {
	extract(text: string): Promise<GlinerSpan[]>;
}

/**
 * Create a GLiNER extractor backed by an ONNX session.
 *
 * Chunks text to maxChunkLength tokens, runs ONNX inference per chunk,
 * and collects spans with their labels and confidence scores.
 *
 * If session is null, returns empty (graceful degradation at T0/T1).
 */
export function createGlinerExtractor(config: GlinerExtractorConfig): GlinerExtractor {
	const { session, maxChunkLength } = config;

	return {
		async extract(text: string): Promise<GlinerSpan[]> {
			if (!session) return [];

			// Chunk text by character limit (~4 chars per token)
			const charLimit = maxChunkLength * 4;
			const chunks: string[] = [];
			for (let i = 0; i < text.length; i += charLimit) {
				chunks.push(text.slice(i, i + charLimit));
			}

			const allSpans: GlinerSpan[] = [];

			for (const chunk of chunks) {
				try {
					// ⚠️  INTENTIONAL PLACEHOLDER — resolved in transformer-stack-activation.md
					//
					// The real GLiNER ONNX interface requires multi-tensor inputs:
					//   input_ids      (int64, [batch, seq_len])
					//   attention_mask (int64, [batch, seq_len])
					//   words_mask     (int64, [batch, seq_len])
					//   text_lengths   (int64, [batch, 1])
					//   span_idx       (int64, [batch, num_spans, 2])
					//   span_mask      (bool,  [batch, num_spans])
					//
					// This string-based call is a structural stub so that the foundation
					// plan's tests (label contracts, confidence thresholds) pass without
					// real ONNX inference. Full tensor construction is implemented in the
					// activation plan Phase 5 / Task 1.2.
					const output = await session.run({
						text: { data: chunk, type: "string" },
						labels: { data: SIA_ENTITY_LABELS.join(","), type: "string" },
					});

					const spans = output.spans as GlinerSpan[] | undefined;
					if (spans) {
						allSpans.push(...spans);
					}
				} catch (err) {
					console.error(
						`[sia] gliner-extractor: chunk ${chunks.indexOf(chunk)}/${chunks.length} inference failed:`,
						err instanceof Error ? err.message : String(err),
					);
				}
			}

			return allSpans;
		},
	};
}
