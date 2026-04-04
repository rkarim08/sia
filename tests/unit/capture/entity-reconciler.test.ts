import { describe, expect, it } from "vitest";
import {
	reconcileExtractions,
	type ReconciliationInput,
} from "@/capture/entity-reconciler";

describe("entity reconciler", () => {
	it("accepts high-confidence GLiNER spans directly", () => {
		const input: ReconciliationInput = {
			glinerSpans: [
				{ text: "express", label: "Dependency", score: 0.9, start: 0, end: 7 },
			],
			regexEntities: [],
		};

		const result = reconcileExtractions(input);
		expect(result.accepted.length).toBe(1);
		expect(result.accepted[0].text).toBe("express");
		expect(result.needsConfirmation.length).toBe(0);
	});

	it("routes mid-confidence spans to needsConfirmation", () => {
		const input: ReconciliationInput = {
			glinerSpans: [
				{ text: "use REST for APIs", label: "Convention", score: 0.5, start: 0, end: 17 },
			],
			regexEntities: [],
		};

		const result = reconcileExtractions(input);
		expect(result.accepted.length).toBe(0);
		expect(result.needsConfirmation.length).toBe(1);
	});

	it("rejects low-confidence spans", () => {
		const input: ReconciliationInput = {
			glinerSpans: [
				{ text: "the", label: "Decision", score: 0.1, start: 0, end: 3 },
			],
			regexEntities: [],
		};

		const result = reconcileExtractions(input);
		expect(result.accepted.length).toBe(0);
		expect(result.needsConfirmation.length).toBe(0);
		expect(result.rejected.length).toBe(1);
	});

	it("deduplicates overlapping spans preferring higher confidence", () => {
		const input: ReconciliationInput = {
			glinerSpans: [
				{ text: "PostgreSQL", label: "Dependency", score: 0.9, start: 10, end: 20 },
				{ text: "PostgreSQL", label: "Dependency", score: 0.7, start: 10, end: 20 },
			],
			regexEntities: [],
		};

		const result = reconcileExtractions(input);
		expect(result.accepted.length).toBe(1);
		expect(result.accepted[0].score).toBe(0.9);
	});

	it("merges regex entities with GLiNER spans", () => {
		const input: ReconciliationInput = {
			glinerSpans: [],
			regexEntities: [
				{ text: "src/capture/embedder.ts", label: "FilePath", score: 1.0, start: 0, end: 23 },
			],
		};

		const result = reconcileExtractions(input);
		expect(result.accepted.length).toBe(1);
		expect(result.accepted[0].label).toBe("FilePath");
	});

	it("handles empty input gracefully", () => {
		const input: ReconciliationInput = { glinerSpans: [], regexEntities: [] };
		const result = reconcileExtractions(input);
		expect(result.accepted).toHaveLength(0);
		expect(result.needsConfirmation).toHaveLength(0);
		expect(result.rejected).toHaveLength(0);
	});

	it("score exactly at threshold is classified as 'accept'", () => {
		// FilePath threshold is 0.6 — exact boundary should be "accept"
		const input: ReconciliationInput = {
			glinerSpans: [
				{ text: "src/index.ts", label: "FilePath", score: 0.6, start: 0, end: 12 },
			],
			regexEntities: [],
		};

		const result = reconcileExtractions(input);
		expect(result.accepted.length).toBe(1);
		expect(result.accepted[0].text).toBe("src/index.ts");
	});
});
