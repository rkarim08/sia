// Module: tokenizer — Basic WordPiece tokenizer for HuggingFace tokenizer.json files

import { readFileSync } from "node:fs";

/** Special token IDs for BERT-style tokenizers. */
const CLS_ID = 101;
const SEP_ID = 102;
const UNK_ID = 100;
const PAD_ID = 0;

/** Default maximum sequence length. */
const DEFAULT_MAX_LENGTH = 128;

/**
 * A loaded tokenizer: just the vocabulary mapping word → token id.
 */
export interface Tokenizer {
	vocab: Map<string, number>;
}

/**
 * Tokenized output ready for ONNX inference.
 */
export interface TokenizedOutput {
	inputIds: BigInt64Array;
	attentionMask: BigInt64Array;
}

/**
 * Load a HuggingFace tokenizer.json and extract its vocabulary.
 *
 * The file format has `model.vocab` as an object mapping token strings to ids.
 */
export function loadTokenizer(tokenizerJsonPath: string): Tokenizer {
	const raw = readFileSync(tokenizerJsonPath, "utf-8");
	const json = JSON.parse(raw);

	const vocabObj: Record<string, number> = json?.model?.vocab ?? {};
	const vocab = new Map<string, number>(Object.entries(vocabObj));

	return { vocab };
}

/**
 * Look up a single token string in the vocabulary, falling back to [UNK].
 */
function lookupToken(vocab: Map<string, number>, token: string): number {
	return vocab.get(token) ?? UNK_ID;
}

/**
 * Perform basic WordPiece-style tokenization:
 *   1. Lowercase the text
 *   2. Strip punctuation into separate tokens
 *   3. Split on whitespace
 *   4. For each word, try to find it in the vocabulary; if not found, split
 *      into sub-word pieces using the ## prefix convention
 *   5. Prepend [CLS], append [SEP], pad to maxLength
 */
export function tokenize(
	tokenizer: Tokenizer,
	text: string,
	maxLength: number = DEFAULT_MAX_LENGTH,
): TokenizedOutput {
	const { vocab } = tokenizer;

	// Lowercase and insert spaces around punctuation so they become separate tokens
	const normalized = text
		.toLowerCase()
		.replace(/([^\w\s])/g, " $1 ")
		.replace(/\s+/g, " ")
		.trim();

	const words = normalized.length > 0 ? normalized.split(" ") : [];

	// Tokenize each word with basic WordPiece
	const tokenIds: number[] = [CLS_ID];

	for (const word of words) {
		// Budget: leave room for trailing [SEP] + current position
		if (tokenIds.length >= maxLength - 1) break;

		if (vocab.has(word)) {
			tokenIds.push(lookupToken(vocab, word));
			continue;
		}

		// Attempt sub-word splitting
		const subTokens = wordPieceSplit(vocab, word);
		for (const st of subTokens) {
			if (tokenIds.length >= maxLength - 1) break;
			tokenIds.push(st);
		}
	}

	tokenIds.push(SEP_ID);

	// Build padded arrays
	const inputIds = new BigInt64Array(maxLength);
	const attentionMask = new BigInt64Array(maxLength);

	for (let i = 0; i < maxLength; i++) {
		if (i < tokenIds.length) {
			inputIds[i] = BigInt(tokenIds[i]);
			attentionMask[i] = 1n;
		} else {
			inputIds[i] = BigInt(PAD_ID);
			attentionMask[i] = 0n;
		}
	}

	return { inputIds, attentionMask };
}

/**
 * Greedy left-to-right WordPiece splitting for a single word.
 * Returns an array of token ids.
 */
function wordPieceSplit(vocab: Map<string, number>, word: string): number[] {
	const ids: number[] = [];
	let start = 0;

	while (start < word.length) {
		let end = word.length;
		let matched = false;

		while (start < end) {
			const substr = start === 0 ? word.slice(start, end) : `##${word.slice(start, end)}`;

			if (vocab.has(substr)) {
				ids.push(lookupToken(vocab, substr));
				matched = true;
				start = end;
				break;
			}
			end--;
		}

		if (!matched) {
			// No sub-word match found — emit [UNK] for this character and advance
			ids.push(UNK_ID);
			start++;
		}
	}

	return ids;
}
