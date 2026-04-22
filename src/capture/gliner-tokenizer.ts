// Module: capture/gliner-tokenizer — GLiNER-specific preprocessing.
// 1. Entity labels are prepended as: <<ENT>> label1 <<SEP>> label2 <<SEP>> ... <<ENT>> text
// 2. Words mask maps subword tokens back to word positions
// 3. Span indices enumerate all candidate spans up to maxWidth

/** Output of GLiNER input preprocessing. */
export interface GlinerModelInput {
	/** Text with entity labels prepended in GLiNER format. */
	textWithLabels: string;
	/** Number of words in the actual text (excluding labels). */
	numWords: number;
	/** All candidate spans as [startWord, endWord] pairs. */
	spanIndices: number[][];
}

/**
 * Generate all candidate span indices for a text of numWords words.
 * Each span is [startWordIdx, endWordIdx] inclusive, up to maxWidth.
 */
export function generateSpanIndices(numWords: number, maxWidth: number): number[][] {
	const spans: number[][] = [];

	for (let width = 1; width <= Math.min(maxWidth, numWords); width++) {
		for (let start = 0; start <= numWords - width; start++) {
			spans.push([start, start + width - 1]);
		}
	}

	return spans;
}

/**
 * Build GLiNER model input by prepending entity labels to the text.
 *
 * Format: <<ENT>> label1 <<SEP>> label2 <<SEP>> ... <<ENT>> actual text
 */
export function buildGlinerInput(
	labels: string[],
	text: string,
	maxSeqLength: number,
	maxWidth = 12,
): GlinerModelInput {
	const labelPrefix = labels
		.map((label, i) => (i === 0 ? `<<ENT>> ${label}` : `<<SEP>> ${label}`))
		.join(" ");

	const textWithLabels = `${labelPrefix} <<ENT>> ${text}`;

	const words = text
		.trim()
		.split(/\s+/)
		.filter((w) => w.length > 0);
	const numWords = words.length;

	const spanIndices = generateSpanIndices(numWords, maxWidth);

	return { textWithLabels, numWords, spanIndices };
}

/**
 * Build the words_mask tensor that maps subword token positions to word indices.
 *
 * words_mask[i] = word_index if token i is the FIRST subword of word_index,
 * words_mask[i] = 0 otherwise (padding, special tokens, continuation subwords).
 *
 * @param tokenizedWords - Array of arrays: for each word, the token indices it was split into
 * @param seqLength - Total sequence length (including special tokens)
 * @param labelTokenCount - Number of tokens used by the label prefix (before actual text)
 */
export function buildWordsMask(
	tokenizedWords: number[][],
	seqLength: number,
	labelTokenCount: number,
): BigInt64Array {
	const mask = new BigInt64Array(seqLength);

	let tokenPos = labelTokenCount;

	for (let wordIdx = 0; wordIdx < tokenizedWords.length; wordIdx++) {
		const tokens = tokenizedWords[wordIdx];
		if (tokens.length > 0 && tokenPos < seqLength) {
			mask[tokenPos] = BigInt(wordIdx + 1); // 1-indexed, 0 means non-word
		}
		tokenPos += tokens.length;
	}

	return mask;
}
