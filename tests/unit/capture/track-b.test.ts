import { describe, expect, it } from "vitest";
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
});
