// Module: capture/tokenizer-dispatch — unified tokenizer dispatch.
// Auto-selects WordPiece/BPE/SentencePiece by registry `tokenizerType`.

import type { TokenizerType } from "@/models/types";
import { MODEL_REGISTRY } from "@/models/registry";

export type { TokenizerType };

/**
 * Unified tokenizer result — wraps the underlying tokenizer with type metadata.
 */
export interface DispatchedTokenizer {
	type: TokenizerType;
	/** Encode text to token IDs */
	encode(text: string): number[];
	/** Vocabulary (for pair tokenizer compatibility) */
	vocab: Record<string, number>;
}

/**
 * Load the correct tokenizer for a model based on its tokenizerType.
 * This is the ONLY function model consumers should call — it replaces
 * direct `loadTokenizer()` calls that only support WordPiece.
 */
export function loadTokenizerForModel(
	tokenizerPath: string,
	tokenizerType: TokenizerType | undefined,
): DispatchedTokenizer {
	const type = tokenizerType ?? "wordpiece";

	switch (type) {
		case "wordpiece": {
			const { loadTokenizer, tokenize } = require("@/capture/tokenizer");
			const tok = loadTokenizer(tokenizerPath);
			return {
				type: "wordpiece",
				encode: (text: string) => {
					const result = tokenize(tok, text, 512);
					return Array.from(result.inputIds).map(Number);
				},
				vocab: tok.vocab,
			};
		}
		case "bpe": {
			try {
				const { createBpeTokenizer } = require("@/capture/bpe-tokenizer");
				const tok = createBpeTokenizer(tokenizerPath);
				return { type: "bpe", encode: (text: string) => tok.encode(text), vocab: tok.vocab ?? {} };
			} catch (err) {
				// BPE module not yet implemented — log and fall back to wordpiece
				const isModuleNotFound = err instanceof Error && err.message.includes("Cannot find module");
				if (isModuleNotFound) {
					console.warn("[sia] BPE tokenizer module not available, falling back to WordPiece");
				} else {
					console.error("[sia] BPE tokenizer failed to load:", err instanceof Error ? err.message : String(err));
				}
				return loadTokenizerForModel(tokenizerPath, "wordpiece");
			}
		}
		case "sentencepiece": {
			try {
				const { loadSentencePieceTokenizer } = require("@/capture/sentencepiece-tokenizer");
				const tok = loadSentencePieceTokenizer(tokenizerPath);
				return { type: "sentencepiece", encode: (text: string) => tok.encode(text), vocab: tok.vocab ?? {} };
			} catch (err) {
				// SentencePiece module not yet implemented — log and fall back to wordpiece
				const isModuleNotFound = err instanceof Error && err.message.includes("Cannot find module");
				if (isModuleNotFound) {
					console.warn("[sia] SentencePiece tokenizer module not available, falling back to WordPiece");
				} else {
					console.error("[sia] SentencePiece tokenizer failed to load:", err instanceof Error ? err.message : String(err));
				}
				return loadTokenizerForModel(tokenizerPath, "wordpiece");
			}
		}
		default:
			throw new Error(`Unknown tokenizer type: ${type}`);
	}
}

/**
 * Convenience: load tokenizer by model name — looks up tokenizerType from registry.
 */
export function loadTokenizerByModelName(
	modelName: string,
	tokenizerPath: string,
): DispatchedTokenizer {
	const entry = MODEL_REGISTRY[modelName];
	return loadTokenizerForModel(tokenizerPath, entry?.tokenizerType);
}
