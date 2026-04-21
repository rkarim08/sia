// Module: gliner-extractor — GLiNER zero-shot NER with SIA-specific entity labels.
//
// Reference: Zaratiana et al., 2023 — "GLiNER: Generalist Model for NER"
// https://arxiv.org/abs/2311.08526
//
import type { OnnxSession } from "@/models/types";
import { buildGlinerInput, buildWordsMask, generateSpanIndices, type GlinerModelInput } from "@/capture/gliner-tokenizer";
import { loadTokenizerForModel, type DispatchedTokenizer } from "@/capture/tokenizer-dispatch";
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

/** Default maximum span width (in words) — matches GLiNER training config. */
const DEFAULT_MAX_SPAN_WIDTH = 12;

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
	session: OnnxSession | null;
	maxChunkLength: number;
	/**
	 * Optional path to the GLiNER tokenizer.json. When provided, the extractor
	 * performs real tensor construction (input_ids, attention_mask, words_mask,
	 * text_lengths, span_idx, span_mask) and invokes the ONNX session with the
	 * multi-tensor GLiNER input contract. When omitted, the extractor falls back
	 * to the legacy string-based placeholder call (used by unit tests with mock
	 * sessions).
	 */
	tokenizerPath?: string;
	/**
	 * Optional tokenizer type — defaults to "sentencepiece" (the GLiNER family
	 * ships as multi-lingual SentencePiece). Forwarded to `loadTokenizerForModel`
	 * which will gracefully fall back to WordPiece if the SentencePiece module
	 * is not yet available in the project.
	 */
	tokenizerType?: "wordpiece" | "bpe" | "sentencepiece";
}

/** Tensor data ready to be wrapped in ONNX `Tensor` objects. */
export interface GlinerTensorData {
	inputIds: BigInt64Array;
	attentionMask: BigInt64Array;
	wordsMask: BigInt64Array;
	/** Shape: [batch=1, 1] — single int64 per batch row. */
	textLengths: BigInt64Array;
	/** Shape: [batch=1, numSpans, 2] — flat length = numSpans * 2. */
	spanIdxData: BigInt64Array;
	/** Shape: [batch=1, numSpans] — 1 for real spans, 0 for padding. */
	spanMaskData: Uint8Array;
	/** Number of candidate spans — consumer needs this to construct tensor shapes. */
	numSpans: number;
	/** Effective sequence length (== maxSeqLength). */
	seqLength: number;
}

/**
 * Build all six input tensors required by the GLiNER ONNX interface.
 *
 * This is a pure, testable helper: no ONNX runtime or I/O. The caller is
 * responsible for wrapping the returned `BigInt64Array` / `Uint8Array`
 * buffers in `ort.Tensor` instances with appropriate shapes.
 *
 * Tensor contract:
 *   input_ids      int64 [1, seq_length]
 *   attention_mask int64 [1, seq_length]
 *   words_mask     int64 [1, seq_length]
 *   text_lengths   int64 [1, 1]
 *   span_idx       int64 [1, num_spans, 2]
 *   span_mask      bool  [1, num_spans]
 */
export function buildGlinerTensors(
	tokenizer: DispatchedTokenizer,
	glinerInput: GlinerModelInput,
	words: string[],
	maxSeqLength: number,
): GlinerTensorData {
	// 1. Encode the full text-with-labels prompt to token ids.
	const fullTokens = tokenizer.encode(glinerInput.textWithLabels);

	// 2. Compute the label-prefix token count so words_mask aligns with the
	//    actual text portion of the sequence. We encode the prefix separately
	//    and use its length as the offset.
	const labelPrefixText = glinerInput.textWithLabels.slice(
		0,
		glinerInput.textWithLabels.lastIndexOf("<<ENT>>") + "<<ENT>>".length,
	);
	const labelPrefixTokens = tokenizer.encode(labelPrefixText);
	const labelTokenCount = Math.min(labelPrefixTokens.length, maxSeqLength);

	// 3. Per-word subword token id arrays (used by buildWordsMask to mark the
	//    first subword position of each word).
	const tokenizedWords: number[][] = words.map((w) => tokenizer.encode(w));

	// 4. input_ids + attention_mask (truncate or pad to maxSeqLength).
	const inputIds = new BigInt64Array(maxSeqLength);
	const attentionMask = new BigInt64Array(maxSeqLength);
	const effectiveLen = Math.min(fullTokens.length, maxSeqLength);
	for (let i = 0; i < effectiveLen; i++) {
		inputIds[i] = BigInt(fullTokens[i] | 0);
		attentionMask[i] = 1n;
	}

	// 5. words_mask — maps subword positions back to word indices (1-indexed).
	const wordsMask = buildWordsMask(tokenizedWords, maxSeqLength, labelTokenCount);

	// 6. text_lengths — number of words in the text portion.
	const textLengths = new BigInt64Array(1);
	textLengths[0] = BigInt(glinerInput.numWords);

	// 7. span_idx + span_mask — all candidate [startWord, endWord] pairs.
	const spanIndices = glinerInput.spanIndices;
	const numSpans = spanIndices.length;
	const spanIdxData = new BigInt64Array(numSpans * 2);
	const spanMaskData = new Uint8Array(numSpans);
	for (let i = 0; i < numSpans; i++) {
		const [start, end] = spanIndices[i];
		spanIdxData[i * 2] = BigInt(start);
		spanIdxData[i * 2 + 1] = BigInt(end);
		spanMaskData[i] = 1;
	}

	return {
		inputIds,
		attentionMask,
		wordsMask,
		textLengths,
		spanIdxData,
		spanMaskData,
		numSpans,
		seqLength: maxSeqLength,
	};
}

/** GLiNER extractor interface. */
export interface GlinerExtractor {
	extract(text: string): Promise<GlinerSpan[]>;
}

/** Sigmoid helper for converting raw logits to probabilities. */
function sigmoid(x: number): number {
	return 1 / (1 + Math.exp(-x));
}

/**
 * Parse a GLiNER logits tensor of shape [1, numSpans, numLabels] into
 * GlinerSpan objects. Applies sigmoid and filters by REJECT_THRESHOLD.
 */
function parseGlinerLogits(
	logits: Float32Array,
	spanIndices: number[][],
	words: string[],
	labels: readonly SiaEntityLabel[],
	chunkOffset: number,
): GlinerSpan[] {
	const spans: GlinerSpan[] = [];
	const numSpans = spanIndices.length;
	const numLabels = labels.length;

	if (logits.length < numSpans * numLabels) {
		// Shape mismatch — the model did not produce a full [spans, labels] grid.
		return spans;
	}

	// Pre-compute word character offsets for converting word-index spans to
	// character-index spans in the original chunk.
	const wordCharStarts: number[] = [];
	const wordCharEnds: number[] = [];
	let cursor = 0;
	for (const w of words) {
		wordCharStarts.push(cursor);
		cursor += w.length;
		wordCharEnds.push(cursor);
		cursor += 1; // account for the single space separator between words
	}

	for (let s = 0; s < numSpans; s++) {
		const [startWord, endWord] = spanIndices[s];
		if (startWord >= words.length || endWord >= words.length) continue;

		for (let l = 0; l < numLabels; l++) {
			const raw = logits[s * numLabels + l];
			const score = sigmoid(raw);
			if (score < REJECT_THRESHOLD) continue;

			const charStart = wordCharStarts[startWord] ?? 0;
			const charEnd = wordCharEnds[endWord] ?? charStart;
			const text = words.slice(startWord, endWord + 1).join(" ");

			spans.push({
				text,
				label: labels[l],
				score,
				start: chunkOffset + charStart,
				end: chunkOffset + charEnd,
			});
		}
	}

	return spans;
}

/**
 * Lazy ONNX runtime loader — mirrors the pattern used by `embedder.ts`.
 * Returns null if `onnxruntime-node` is not installed.
 */
async function loadOnnxRuntime(): Promise<typeof import("onnxruntime-node") | null> {
	try {
		return await import("onnxruntime-node");
	} catch (err) {
		if (err instanceof Error && (err.message.includes("Cannot find module") || err.message.includes("MODULE_NOT_FOUND"))) {
			console.debug("[sia] gliner-extractor: onnxruntime-node not installed — real-tensor path disabled");
		} else {
			console.error("[sia] gliner-extractor: unexpected error loading onnxruntime-node:", err instanceof Error ? err.message : String(err));
		}
		return null;
	}
}

/**
 * Create a GLiNER extractor backed by an ONNX session.
 *
 * Chunks text to maxChunkLength tokens, runs ONNX inference per chunk,
 * and collects spans with their labels and confidence scores.
 *
 * If session is null, returns empty (graceful degradation at T0/T1).
 *
 * When `tokenizerPath` is provided, real multi-tensor GLiNER inputs are built
 * and the output `logits` tensor is parsed. When omitted, falls back to the
 * legacy string-feed placeholder (used by unit tests with mock sessions).
 */
export function createGlinerExtractor(config: GlinerExtractorConfig): GlinerExtractor {
	const { session, maxChunkLength, tokenizerPath, tokenizerType } = config;
	let nullSessionLogged = false;
	let tokenizer: DispatchedTokenizer | null = null;
	let tokenizerLoaded = false;
	let ort: typeof import("onnxruntime-node") | null = null;
	let ortLoaded = false;

	async function ensureTokenizer(): Promise<DispatchedTokenizer | null> {
		if (tokenizerLoaded) return tokenizer;
		tokenizerLoaded = true;
		if (!tokenizerPath) return null;
		try {
			tokenizer = loadTokenizerForModel(tokenizerPath, tokenizerType ?? "sentencepiece");
			return tokenizer;
		} catch (err) {
			console.error(
				"[sia] gliner-extractor: failed to load tokenizer from",
				tokenizerPath,
				err instanceof Error ? err.message : String(err),
			);
			tokenizer = null;
			return null;
		}
	}

	async function ensureOrt(): Promise<typeof import("onnxruntime-node") | null> {
		if (ortLoaded) return ort;
		ortLoaded = true;
		ort = await loadOnnxRuntime();
		return ort;
	}

	return {
		async extract(text: string): Promise<GlinerSpan[]> {
			if (!session) {
				if (!nullSessionLogged) {
					console.error("[sia] gliner-extractor: session is null — extraction disabled (T0/T1 degradation)");
					nullSessionLogged = true;
				}
				return [];
			}

			// Chunk text by character limit (~4 chars per token)
			const charLimit = maxChunkLength * 4;
			const chunks: string[] = [];
			const chunkOffsets: number[] = [];
			for (let i = 0; i < text.length; i += charLimit) {
				chunks.push(text.slice(i, i + charLimit));
				chunkOffsets.push(i);
			}

			const allSpans: GlinerSpan[] = [];

			const tok = await ensureTokenizer();
			const ortMod = tok ? await ensureOrt() : null;
			const useRealTensors = tok !== null && ortMod !== null;

			for (let c = 0; c < chunks.length; c++) {
				const chunk = chunks[c];
				try {
					if (!useRealTensors) {
						// Legacy placeholder path — no tokenizer configured or ORT unavailable.
						// Kept for backward compatibility with unit tests that use mock sessions.
						const output = await session.run({
							text: { data: chunk, type: "string" },
							labels: { data: SIA_ENTITY_LABELS.join(","), type: "string" },
						});
						const spans = output.spans as GlinerSpan[] | undefined;
						if (spans) {
							allSpans.push(...spans);
						}
						continue;
					}

					// Real tensor path.
					const glinerInput = buildGlinerInput(
						SIA_ENTITY_LABELS as unknown as string[],
						chunk,
						maxChunkLength,
						DEFAULT_MAX_SPAN_WIDTH,
					);
					const words = chunk.trim().split(/\s+/).filter((w) => w.length > 0);
					const tensors = buildGlinerTensors(tok as DispatchedTokenizer, glinerInput, words, maxChunkLength);

					const seqShape = [1, tensors.seqLength];
					const feeds = {
						input_ids: new (ortMod as typeof import("onnxruntime-node")).Tensor("int64", tensors.inputIds, seqShape),
						attention_mask: new (ortMod as typeof import("onnxruntime-node")).Tensor("int64", tensors.attentionMask, seqShape),
						words_mask: new (ortMod as typeof import("onnxruntime-node")).Tensor("int64", tensors.wordsMask, seqShape),
						text_lengths: new (ortMod as typeof import("onnxruntime-node")).Tensor("int64", tensors.textLengths, [1, 1]),
						span_idx: new (ortMod as typeof import("onnxruntime-node")).Tensor("int64", tensors.spanIdxData, [1, tensors.numSpans, 2]),
						span_mask: new (ortMod as typeof import("onnxruntime-node")).Tensor("bool", tensors.spanMaskData, [1, tensors.numSpans]),
					};

					const output = await session.run(feeds);
					const logits = output.logits as { data: Float32Array; dims: readonly number[] } | undefined;
					if (!logits?.data) {
						console.error(
							`[sia] gliner-extractor: chunk ${c}/${chunks.length} — ONNX output missing 'logits' tensor`,
						);
						continue;
					}

					const parsed = parseGlinerLogits(
						logits.data,
						glinerInput.spanIndices,
						words,
						SIA_ENTITY_LABELS,
						chunkOffsets[c],
					);
					allSpans.push(...parsed);
				} catch (err) {
					console.error(
						`[sia] gliner-extractor: chunk ${c}/${chunks.length} inference failed:`,
						err instanceof Error ? err.message : String(err),
					);
				}
			}

			return allSpans;
		},
	};
}

// Re-export for convenience — callers building tensors outside this module.
export { generateSpanIndices };
