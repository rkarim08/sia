// tests/unit/retrieval/context-assembly.test.ts

import { describe, expect, it } from "vitest";
import type { SiaSearchResult } from "@/graph/types";
import { assembleSearchResult, enforceResponseBudget } from "@/retrieval/context-assembly";

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "entity-1",
		type: "function",
		name: "myFunction",
		summary: "Does something useful",
		content: "function myFunction() {}",
		tags: JSON.stringify(["tag1", "tag2"]),
		file_paths: JSON.stringify(["src/foo.ts", "src/bar.ts"]),
		trust_tier: "code",
		confidence: 0.9,
		importance: 0.8,
		conflict_group_id: "cg-1",
		t_valid_from: 1000,
		t_valid_until: null,
		extraction_method: "ast",
		...overrides,
	};
}

describe("assembleSearchResult", () => {
	it("maps entity row to SiaSearchResult with parsed tags and file_paths", () => {
		const row = makeRow();
		const result = assembleSearchResult(row);

		expect(result.entity_id).toBe("entity-1");
		expect(result.type).toBe("function");
		expect(result.name).toBe("myFunction");
		expect(result.summary).toBe("Does something useful");
		expect(result.content).toBe("function myFunction() {}");
		expect(result.tags).toEqual(["tag1", "tag2"]);
		expect(result.file_paths).toEqual(["src/foo.ts", "src/bar.ts"]);
		expect(result.trust_tier).toBe("code");
		expect(result.confidence).toBe(0.9);
		expect(result.importance).toBe(0.8);
		expect(result.conflict_group_id).toBe("cg-1");
		expect(result.t_valid_from).toBe(1000);
		expect(result.t_valid_until).toBeNull();
	});

	it("excludes extraction_method by default", () => {
		const row = makeRow();
		const result = assembleSearchResult(row);

		expect(result.extraction_method).toBeUndefined();
	});

	it("includes extraction_method when includeProvenance is true", () => {
		const row = makeRow();
		const result = assembleSearchResult(row, { includeProvenance: true });

		expect(result.extraction_method).toBe("ast");
	});

	it("does not include extraction_method when row has no extraction_method even with provenance", () => {
		const row = makeRow({ extraction_method: undefined });
		const result = assembleSearchResult(row, { includeProvenance: true });

		expect(result.extraction_method).toBeUndefined();
	});

	it("handles malformed JSON tags gracefully by returning []", () => {
		const row = makeRow({ tags: "not-valid-json{{{" });
		const result = assembleSearchResult(row);

		expect(result.tags).toEqual([]);
	});

	it("handles malformed JSON file_paths gracefully by returning []", () => {
		const row = makeRow({ file_paths: "{bad json" });
		const result = assembleSearchResult(row);

		expect(result.file_paths).toEqual([]);
	});

	it("handles null/undefined tags by returning []", () => {
		const row = makeRow({ tags: null });
		const result = assembleSearchResult(row);

		expect(result.tags).toEqual([]);
	});

	it("handles tags that parse to a non-array by returning []", () => {
		const row = makeRow({ tags: JSON.stringify({ notAnArray: true }) });
		const result = assembleSearchResult(row);

		expect(result.tags).toEqual([]);
	});

	it("defaults conflict_group_id to null when not present in row", () => {
		const row = makeRow({ conflict_group_id: undefined });
		const result = assembleSearchResult(row);

		expect(result.conflict_group_id).toBeNull();
	});

	it("defaults t_valid_from to null when not present in row", () => {
		const row = makeRow({ t_valid_from: undefined });
		const result = assembleSearchResult(row);

		expect(result.t_valid_from).toBeNull();
	});
});

describe("enforceResponseBudget", () => {
	function makeResult(id: string): SiaSearchResult {
		return {
			entity_id: id,
			type: "function",
			name: `fn-${id}`,
			summary: "summary",
			content: "content",
			tags: [],
			file_paths: [],
			trust_tier: 1 as const,
			confidence: 1,
			importance: 1,
		};
	}

	it("returns all results when within budget (truncated: false)", () => {
		const results = [makeResult("1"), makeResult("2")];
		// 2 results × 150 tokens = 300 tokens needed; budget = 450
		const out = enforceResponseBudget(results, 450);

		expect(out.results).toHaveLength(2);
		expect(out.truncated).toBe(false);
	});

	it("returns exact fit without truncation", () => {
		const results = [makeResult("1"), makeResult("2"), makeResult("3")];
		// 3 results × 150 tokens = 450 tokens; budget = 450
		const out = enforceResponseBudget(results, 450);

		expect(out.results).toHaveLength(3);
		expect(out.truncated).toBe(false);
	});

	it("truncates when exceeding budget (truncated: true)", () => {
		const results = [makeResult("1"), makeResult("2"), makeResult("3"), makeResult("4")];
		// budget = 450 → maxResults = floor(450/150) = 3
		const out = enforceResponseBudget(results, 450);

		expect(out.results).toHaveLength(3);
		expect(out.truncated).toBe(true);
	});

	it("returns empty array with truncated: false when input is empty", () => {
		const out = enforceResponseBudget([], 1000);

		expect(out.results).toHaveLength(0);
		expect(out.truncated).toBe(false);
	});

	it("returns empty with truncated: true for zero budget when results exist", () => {
		const results = [makeResult("1")];
		const out = enforceResponseBudget(results, 0);

		expect(out.results).toHaveLength(0);
		expect(out.truncated).toBe(true);
	});

	it("returns empty with truncated: false for zero budget when results is empty", () => {
		const out = enforceResponseBudget([], 0);

		expect(out.results).toHaveLength(0);
		expect(out.truncated).toBe(false);
	});

	it("returns empty with truncated: true for negative budget when results exist", () => {
		const results = [makeResult("1")];
		const out = enforceResponseBudget(results, -1);

		expect(out.results).toHaveLength(0);
		expect(out.truncated).toBe(true);
	});
});
