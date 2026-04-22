import { describe, expect, it } from "vitest";
import { buildGlinerInput, generateSpanIndices } from "@/capture/gliner-tokenizer";

describe("GLiNER tokenizer", () => {
	it("generateSpanIndices creates all spans up to maxWidth", () => {
		const numWords = 5;
		const maxWidth = 3;
		const spans = generateSpanIndices(numWords, maxWidth);

		// With 5 words and maxWidth 3:
		// Width 1: [0,0], [1,1], [2,2], [3,3], [4,4] = 5
		// Width 2: [0,1], [1,2], [2,3], [3,4] = 4
		// Width 3: [0,2], [1,3], [2,4] = 3
		// Total: 12
		expect(spans.length).toBe(12);
		expect(spans[0]).toEqual([0, 0]);
		expect(spans[spans.length - 1]).toEqual([2, 4]);
	});

	it("generateSpanIndices handles empty text", () => {
		expect(generateSpanIndices(0, 3)).toEqual([]);
	});

	it("buildGlinerInput prepends entity labels to text", () => {
		const labels = ["Decision", "Bug"];
		const text = "chose PostgreSQL for ACID";

		const input = buildGlinerInput(labels, text, 64);

		expect(input.textWithLabels).toContain("Decision");
		expect(input.textWithLabels).toContain("Bug");
		expect(input.textWithLabels).toContain("chose PostgreSQL for ACID");
	});

	it("buildGlinerInput computes word count", () => {
		const input = buildGlinerInput(["Decision"], "hello world foo bar", 64);

		expect(input.numWords).toBe(4);
	});
});
