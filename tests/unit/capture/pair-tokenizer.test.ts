import { describe, expect, it } from "vitest";
import { tokenizePair } from "@/capture/pair-tokenizer";

describe("pair tokenizer", () => {
	it("produces inputIds starting with CLS (101) and containing two SEPs (102)", () => {
		// Use a mock vocab for testing
		const mockVocab = new Map<string, number>([
			["[CLS]", 101],
			["[SEP]", 102],
			["[PAD]", 0],
			["[UNK]", 100],
			["hello", 7592],
			["world", 2088],
			["test", 3231],
		]);

		const result = tokenizePair(mockVocab, "hello", "world test", 16);

		// Should start with CLS
		expect(result.inputIds[0]).toBe(101n);

		// Should contain at least two SEP tokens
		const sepCount = Array.from(result.inputIds).filter((id) => id === 102n).length;
		expect(sepCount).toBeGreaterThanOrEqual(2);
	});

	it("token_type_ids are 0 for query, 1 for passage", () => {
		const mockVocab = new Map<string, number>([
			["[CLS]", 101],
			["[SEP]", 102],
			["[PAD]", 0],
			["[UNK]", 100],
			["query", 23032],
			["passage", 6019],
		]);

		const result = tokenizePair(mockVocab, "query", "passage", 16);

		// CLS and query tokens should be type 0
		expect(result.tokenTypeIds[0]).toBe(0n); // CLS

		// Find the first SEP — everything after it (up to second SEP) should be type 1
		let firstSepIdx = -1;
		for (let i = 1; i < result.inputIds.length; i++) {
			if (result.inputIds[i] === 102n) {
				firstSepIdx = i;
				break;
			}
		}
		expect(firstSepIdx).toBeGreaterThan(0);

		// Token after first SEP should be type 1 (passage tokens)
		if (firstSepIdx + 1 < result.inputIds.length && result.inputIds[firstSepIdx + 1] !== 0n) {
			expect(result.tokenTypeIds[firstSepIdx + 1]).toBe(1n);
		}
	});

	it("pads to maxSeqLength", () => {
		const mockVocab = new Map<string, number>([
			["[CLS]", 101],
			["[SEP]", 102],
			["[PAD]", 0],
			["[UNK]", 100],
			["a", 1037],
		]);

		const result = tokenizePair(mockVocab, "a", "a", 32);
		expect(result.inputIds.length).toBe(32);
		expect(result.attentionMask.length).toBe(32);
		expect(result.tokenTypeIds.length).toBe(32);
	});
});
