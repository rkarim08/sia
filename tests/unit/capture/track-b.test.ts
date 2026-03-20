import { describe, expect, it, vi } from "vitest";
import { extractTrackB } from "@/capture/track-b-llm";

describe("capture/track-b-llm", () => {
	// ---------------------------------------------------------------
	// airGapped returns empty immediately
	// ---------------------------------------------------------------

	it("airGapped returns empty immediately", async () => {
		const result = await extractTrackB("We decided to use React", {
			captureModel: "haiku",
			minExtractConfidence: 0.5,
			airGapped: true,
		});
		expect(result).toEqual([]);
	});

	// ---------------------------------------------------------------
	// Extracts decision-like content
	// ---------------------------------------------------------------

	it("extracts decision-like content", async () => {
		const result = await extractTrackB("We decided to use SQLite for local persistence", {
			captureModel: "haiku",
			minExtractConfidence: 0.5,
			airGapped: false,
		});
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("Decision");
		expect(result[0].content).toBe("We decided to use SQLite for local persistence");
	});

	// ---------------------------------------------------------------
	// Extracts bug-like content
	// ---------------------------------------------------------------

	it("extracts bug-like content", async () => {
		const result = await extractTrackB(
			"There is a bug in the authentication module causing a crash",
			{
				captureModel: "haiku",
				minExtractConfidence: 0.5,
				airGapped: false,
			},
		);
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("Bug");
	});

	// ---------------------------------------------------------------
	// Extracts convention-like content
	// ---------------------------------------------------------------

	it("extracts convention-like content", async () => {
		const result = await extractTrackB("You must always use camelCase for variable names", {
			captureModel: "haiku",
			minExtractConfidence: 0.5,
			airGapped: false,
		});
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("Convention");
	});

	// ---------------------------------------------------------------
	// Extracts solution-like content
	// ---------------------------------------------------------------

	it("extracts solution-like content", async () => {
		const result = await extractTrackB("We solved the issue by adding a retry mechanism", {
			captureModel: "haiku",
			minExtractConfidence: 0.5,
			airGapped: false,
		});
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("Solution");
	});

	// ---------------------------------------------------------------
	// Filters below minExtractConfidence
	// ---------------------------------------------------------------

	it("filters below minExtractConfidence", async () => {
		const result = await extractTrackB(
			"We decided to use React.\nThere is a bug in the parser.\nYou must use strict mode.\nWe solved the caching issue.",
			{
				captureModel: "haiku",
				minExtractConfidence: 0.8,
				airGapped: false,
			},
		);
		expect(result).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// All results have trust_tier=3
	// ---------------------------------------------------------------

	it("all results have trust_tier=3", async () => {
		const result = await extractTrackB(
			"We decided to go with Postgres.\nThere is an error in the build.\nYou must lint before committing.\nThe workaround is to clear the cache.",
			{
				captureModel: "haiku",
				minExtractConfidence: 0.5,
				airGapped: false,
			},
		);
		expect(result.length).toBeGreaterThan(0);
		for (const fact of result) {
			expect(fact.trust_tier).toBe(3);
		}
	});

	// ---------------------------------------------------------------
	// All results have extraction_method='pattern-match'
	// ---------------------------------------------------------------

	it("all results have extraction_method='pattern-match'", async () => {
		const result = await extractTrackB(
			"We chose TypeScript.\nThe regression broke the tests.\nYou never commit directly to main.\nThe patch resolved the build issue.",
			{
				captureModel: "haiku",
				minExtractConfidence: 0.5,
				airGapped: false,
			},
		);
		expect(result.length).toBeGreaterThan(0);
		for (const fact of result) {
			expect(fact.extraction_method).toBe("pattern-match");
		}
	});

	// ---------------------------------------------------------------
	// LLM path: calls LLM when llmClient provided and not airGapped
	// ---------------------------------------------------------------

	it("calls LLM when llmClient provided and not airGapped", async () => {
		const mockFacts = [
			{
				type: "Decision",
				name: "Use SQLite",
				content: "We decided to use SQLite for local persistence",
				summary: "SQLite chosen for local storage",
				tags: ["database", "sqlite"],
				file_paths: [],
				confidence: 0.9,
			},
		];
		const mockCreate = vi.fn().mockResolvedValue({
			content: [{ text: JSON.stringify({ facts: mockFacts }) }],
		});
		const llmClient = { messages: { create: mockCreate } };

		const result = await extractTrackB("We decided to use SQLite for local persistence", {
			captureModel: "claude-haiku-4-5",
			minExtractConfidence: 0.5,
			airGapped: false,
			llmClient,
		});

		expect(mockCreate).toHaveBeenCalledOnce();
		expect(result).toHaveLength(1);
		expect(result[0].extraction_method).toBe("llm-haiku");
		expect(result[0].type).toBe("Decision");
		expect(result[0].trust_tier).toBe(3);
	});

	// ---------------------------------------------------------------
	// LLM path: falls back to pattern matching when LLM throws
	// ---------------------------------------------------------------

	it("falls back to pattern matching when LLM throws", async () => {
		const mockCreate = vi.fn().mockRejectedValue(new Error("API error"));
		const llmClient = { messages: { create: mockCreate } };

		const result = await extractTrackB("We decided to use SQLite for local persistence", {
			captureModel: "claude-haiku-4-5",
			minExtractConfidence: 0.5,
			airGapped: false,
			llmClient,
		});

		expect(mockCreate).toHaveBeenCalledOnce();
		expect(result).toHaveLength(1);
		expect(result[0].extraction_method).toBe("pattern-match");
	});

	// ---------------------------------------------------------------
	// LLM path: falls back to pattern matching when LLM returns invalid JSON
	// ---------------------------------------------------------------

	it("falls back to pattern matching when LLM returns invalid JSON", async () => {
		const mockCreate = vi.fn().mockResolvedValue({
			content: [{ text: "not valid json {{{" }],
		});
		const llmClient = { messages: { create: mockCreate } };

		const result = await extractTrackB("We decided to use SQLite for local persistence", {
			captureModel: "claude-haiku-4-5",
			minExtractConfidence: 0.5,
			airGapped: false,
			llmClient,
		});

		expect(result).toHaveLength(1);
		expect(result[0].extraction_method).toBe("pattern-match");
	});

	// ---------------------------------------------------------------
	// LLM path: filters LLM results below minExtractConfidence
	// ---------------------------------------------------------------

	it("filters LLM results below minExtractConfidence", async () => {
		const mockFacts = [
			{
				type: "Decision",
				name: "Low confidence fact",
				content: "Some low confidence content",
				summary: "Low confidence",
				tags: [],
				file_paths: [],
				confidence: 0.3,
			},
			{
				type: "Bug",
				name: "High confidence fact",
				content: "High confidence bug description",
				summary: "High confidence",
				tags: [],
				file_paths: [],
				confidence: 0.9,
			},
		];
		const mockCreate = vi.fn().mockResolvedValue({
			content: [{ text: JSON.stringify({ facts: mockFacts }) }],
		});
		const llmClient = { messages: { create: mockCreate } };

		const result = await extractTrackB("Some content here", {
			captureModel: "claude-haiku-4-5",
			minExtractConfidence: 0.6,
			airGapped: false,
			llmClient,
		});

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("High confidence fact");
		expect(result[0].extraction_method).toBe("llm-haiku");
	});
});
