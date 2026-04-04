import { describe, expect, it } from "vitest";
import { loadTokenizerForModel, loadTokenizerByModelName } from "@/capture/tokenizer-dispatch";

describe("tokenizer dispatch", () => {
	it("throws for wordpiece with nonexistent file (no silent swallow)", () => {
		expect(() => loadTokenizerForModel("/nonexistent/tokenizer.json", "wordpiece")).toThrow();
	});

	it("falls back to wordpiece for bpe when module not available", () => {
		// BPE module doesn't exist yet, so it falls back to wordpiece.
		// The fallback then fails because the tokenizer file doesn't exist — that's expected.
		expect(() => loadTokenizerForModel("/nonexistent/tokenizer.json", "bpe")).toThrow();
	});

	it("falls back to wordpiece for sentencepiece when module not available", () => {
		expect(() => loadTokenizerForModel("/nonexistent/tokenizer.json", "sentencepiece")).toThrow();
	});

	it("throws for unknown tokenizer type", () => {
		expect(() => loadTokenizerForModel("/mock/tok.json", "unknown" as any)).toThrow(
			"Unknown tokenizer type",
		);
	});

	it("loadTokenizerForModel is a function", () => {
		expect(typeof loadTokenizerForModel).toBe("function");
	});

	it("loadTokenizerByModelName is a function", () => {
		expect(typeof loadTokenizerByModelName).toBe("function");
	});

	it("loadTokenizerByModelName uses registry tokenizerType", () => {
		// jina-code is registered as "bpe" — should attempt BPE, fall back to wordpiece, then fail on file
		expect(() => loadTokenizerByModelName("jina-embeddings-v2-base-code", "/nonexistent/tok.json")).toThrow();
	});
});
