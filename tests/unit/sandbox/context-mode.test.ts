import { describe, expect, it } from "vitest";
import { applyContextMode } from "../../../src/sandbox/context-mode";

describe("applyContextMode", () => {
	it("returns short output as-is with contextSaved false", () => {
		const output = "short output";
		const result = applyContextMode(output, "some intent");
		expect(result.chunks).toEqual([output]);
		expect(result.totalIndexed).toBe(0);
		expect(result.contextSaved).toBe(false);
	});

	it("returns contextSaved true for large output", () => {
		const output = "x".repeat(20000);
		const result = applyContextMode(output, "something");
		expect(result.contextSaved).toBe(true);
		expect(result.totalIndexed).toBeGreaterThan(0);
	});

	it("large output with intent 'OOM errors' — only chunks containing OOM returned", () => {
		// Build a large output: many lines without OOM, then some with OOM
		const noiseLines = Array.from({ length: 100 }, (_, i) => `line ${i}: normal log output here`);
		const oomLines = [
			"CRITICAL: OOM killer invoked on process 1234",
			"OOM error detected in heap allocation",
			"Another OOM event triggered",
		];
		// Interleave OOM lines at the end
		const output = [...noiseLines, ...oomLines].join("\n");
		// Make sure output exceeds threshold
		const longOutput = `${output}\n${"padding ".repeat(500)}`;

		const result = applyContextMode(longOutput, "OOM errors", 100);
		expect(result.contextSaved).toBe(true);
		expect(result.totalIndexed).toBeGreaterThan(0);
		// Top chunks should contain OOM
		const hasOom = result.chunks.some((c) => c.includes("OOM"));
		expect(hasOom).toBe(true);
	});

	it("empty intent returns first 5 chunks (all score 0)", () => {
		// Build large output with clearly distinguishable chunks
		const lines: string[] = [];
		for (let i = 0; i < 200; i++) {
			lines.push(`chunk-line-${i}: ${"a".repeat(20)}`);
		}
		const output = lines.join("\n");

		const result = applyContextMode(output, "", 100);
		expect(result.contextSaved).toBe(true);
		expect(result.chunks.length).toBeLessThanOrEqual(5);
		expect(result.totalIndexed).toBeGreaterThan(0);
	});

	it("respects custom threshold", () => {
		const output = "hello world";
		// With threshold of 5, output.length(11) >= 5
		const result = applyContextMode(output, "hello", 5);
		expect(result.contextSaved).toBe(true);
	});

	it("returns at most 5 chunks for large output", () => {
		const lines = Array.from({ length: 500 }, (_, i) => `line ${i}: ${"word ".repeat(10)}`);
		const output = lines.join("\n");
		const result = applyContextMode(output, "word", 100);
		expect(result.chunks.length).toBeLessThanOrEqual(5);
	});
});
