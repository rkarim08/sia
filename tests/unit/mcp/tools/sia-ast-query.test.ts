import { describe, expect, it } from "vitest";
import type { SiaQueryMatch } from "@/ast/tree-sitter/types";
import {
	extractCalls,
	extractImports,
	extractSymbols,
	handleSiaAstQuery,
	type SiaAstQueryInput,
} from "@/mcp/tools/sia-ast-query";

// ---------------------------------------------------------------------------
// Deterministic unit tests for extraction functions (no tree-sitter needed)
// ---------------------------------------------------------------------------

describe("extractSymbols", () => {
	it("extracts symbols with @name and @kind captures", () => {
		const matches: SiaQueryMatch[] = [
			{
				patternIndex: 0,
				captures: [
					{
						name: "name",
						text: "myFunction",
						startPosition: { row: 5, column: 0 },
						endPosition: { row: 5, column: 10 },
						startIndex: 0,
						endIndex: 10,
					},
					{
						name: "kind",
						text: "function_declaration",
						startPosition: { row: 5, column: 0 },
						endPosition: { row: 5, column: 30 },
						startIndex: 0,
						endIndex: 30,
					},
				],
			},
		];
		const result = extractSymbols(matches, 100);
		expect(result).toEqual([{ name: "myFunction", kind: "function_declaration", line: 6 }]);
	});

	it("falls back to first capture when no @name", () => {
		const matches: SiaQueryMatch[] = [
			{
				patternIndex: 0,
				captures: [
					{
						name: "definition",
						text: "class Foo",
						startPosition: { row: 10, column: 0 },
						endPosition: { row: 10, column: 9 },
						startIndex: 0,
						endIndex: 9,
					},
				],
			},
		];
		const result = extractSymbols(matches, 100);
		expect(result).toEqual([{ name: "class Foo", kind: "definition", line: 11 }]);
	});

	it("respects maxResults limit", () => {
		const matches: SiaQueryMatch[] = Array.from({ length: 10 }, (_, i) => ({
			patternIndex: 0,
			captures: [
				{
					name: "name",
					text: `sym${i}`,
					startPosition: { row: i, column: 0 },
					endPosition: { row: i, column: 4 },
					startIndex: 0,
					endIndex: 4,
				},
			],
		}));
		const result = extractSymbols(matches, 3);
		expect(result).toHaveLength(3);
	});

	it("skips matches with no name", () => {
		const matches: SiaQueryMatch[] = [{ patternIndex: 0, captures: [] }];
		const result = extractSymbols(matches, 100);
		expect(result).toEqual([]);
	});
});

describe("extractImports", () => {
	it("extracts import paths from @source captures", () => {
		const matches: SiaQueryMatch[] = [
			{
				patternIndex: 0,
				captures: [
					{
						name: "source",
						text: '"./utils"',
						startPosition: { row: 0, column: 0 },
						endPosition: { row: 0, column: 9 },
						startIndex: 0,
						endIndex: 9,
					},
				],
			},
		];
		const result = extractImports(matches, 100);
		expect(result).toEqual(["./utils"]);
	});

	it("strips single and double quotes", () => {
		const matches: SiaQueryMatch[] = [
			{
				patternIndex: 0,
				captures: [
					{
						name: "source",
						text: "'lodash'",
						startPosition: { row: 0, column: 0 },
						endPosition: { row: 0, column: 8 },
						startIndex: 0,
						endIndex: 8,
					},
				],
			},
			{
				patternIndex: 0,
				captures: [
					{
						name: "source",
						text: '"react"',
						startPosition: { row: 1, column: 0 },
						endPosition: { row: 1, column: 7 },
						startIndex: 0,
						endIndex: 7,
					},
				],
			},
		];
		const result = extractImports(matches, 100);
		expect(result).toEqual(["lodash", "react"]);
	});

	it("deduplicates imports", () => {
		const matches: SiaQueryMatch[] = [
			{
				patternIndex: 0,
				captures: [
					{
						name: "source",
						text: '"react"',
						startPosition: { row: 0, column: 0 },
						endPosition: { row: 0, column: 7 },
						startIndex: 0,
						endIndex: 7,
					},
				],
			},
			{
				patternIndex: 0,
				captures: [
					{
						name: "source",
						text: '"react"',
						startPosition: { row: 1, column: 0 },
						endPosition: { row: 1, column: 7 },
						startIndex: 0,
						endIndex: 7,
					},
				],
			},
		];
		const result = extractImports(matches, 100);
		expect(result).toEqual(["react"]);
	});

	it("respects maxResults", () => {
		const matches: SiaQueryMatch[] = Array.from({ length: 5 }, (_, i) => ({
			patternIndex: 0,
			captures: [
				{
					name: "source",
					text: `"pkg${i}"`,
					startPosition: { row: i, column: 0 },
					endPosition: { row: i, column: 6 },
					startIndex: 0,
					endIndex: 6,
				},
			],
		}));
		const result = extractImports(matches, 2);
		expect(result).toHaveLength(2);
	});
});

describe("extractCalls", () => {
	it("extracts call targets from @name captures", () => {
		const matches: SiaQueryMatch[] = [
			{
				patternIndex: 0,
				captures: [
					{
						name: "name",
						text: "fetchData",
						startPosition: { row: 0, column: 0 },
						endPosition: { row: 0, column: 9 },
						startIndex: 0,
						endIndex: 9,
					},
				],
			},
		];
		const result = extractCalls(matches, 100);
		expect(result).toEqual(["fetchData"]);
	});

	it("deduplicates calls", () => {
		const matches: SiaQueryMatch[] = [
			{
				patternIndex: 0,
				captures: [
					{
						name: "call",
						text: "console.log",
						startPosition: { row: 0, column: 0 },
						endPosition: { row: 0, column: 11 },
						startIndex: 0,
						endIndex: 11,
					},
				],
			},
			{
				patternIndex: 0,
				captures: [
					{
						name: "call",
						text: "console.log",
						startPosition: { row: 1, column: 0 },
						endPosition: { row: 1, column: 11 },
						startIndex: 0,
						endIndex: 11,
					},
				],
			},
		];
		const result = extractCalls(matches, 100);
		expect(result).toEqual(["console.log"]);
	});
});

// ---------------------------------------------------------------------------
// Integration tests for handleSiaAstQuery (depend on tree-sitter availability)
// ---------------------------------------------------------------------------

describe("handleSiaAstQuery", () => {
	it("should return symbols for a TypeScript file", async () => {
		const input: SiaAstQueryInput = {
			file_path: "src/shared/types.ts",
			query_type: "symbols",
		};
		const result = await handleSiaAstQuery(input);
		expect(result.file_path).toBe("src/shared/types.ts");
		expect(result.language).toBe("typescript");
		// Tree-sitter may not be available in test env — if so, expect graceful fallback
		if (!result.error) {
			expect(result.symbols).toBeDefined();
			expect(result.symbols!.length).toBeGreaterThan(0);
		}
	});

	it("should handle non-existent files gracefully", async () => {
		const input: SiaAstQueryInput = {
			file_path: "non/existent/file.ts",
			query_type: "symbols",
		};
		const result = await handleSiaAstQuery(input);
		expect(result.error).toBeDefined();
		expect(result.error).toContain("File not found");
	});

	it("should handle unsupported file types gracefully", async () => {
		const input: SiaAstQueryInput = {
			file_path: "README.md",
			query_type: "symbols",
		};
		const result = await handleSiaAstQuery(input);
		expect(result.error).toBeDefined();
		expect(result.error).toContain("Unsupported language");
	});

	it("should reject path traversal attempts", async () => {
		const input: SiaAstQueryInput = {
			file_path: "../../etc/passwd",
			query_type: "symbols",
		};
		const result = await handleSiaAstQuery(input);
		expect(result.error).toBeDefined();
		expect(result.error).toContain("Path must be within the project directory");
	});

	it("should return imports for a TypeScript file", async () => {
		const input: SiaAstQueryInput = {
			file_path: "src/mcp/server.ts",
			query_type: "imports",
		};
		const result = await handleSiaAstQuery(input);
		expect(result.file_path).toBe("src/mcp/server.ts");
		if (!result.error) {
			expect(result.imports).toBeDefined();
			expect(result.imports!.length).toBeGreaterThan(0);
		}
	});

	it("should return calls for a TypeScript file", async () => {
		const input: SiaAstQueryInput = {
			file_path: "src/mcp/server.ts",
			query_type: "calls",
		};
		const result = await handleSiaAstQuery(input);
		expect(result.file_path).toBe("src/mcp/server.ts");
		if (!result.error) {
			expect(result.calls).toBeDefined();
		}
	});

	it("should respect max_results limit", async () => {
		const input: SiaAstQueryInput = {
			file_path: "src/mcp/server.ts",
			query_type: "symbols",
			max_results: 3,
		};
		const result = await handleSiaAstQuery(input);
		if (!result.error && result.symbols) {
			expect(result.symbols.length).toBeLessThanOrEqual(3);
		}
	});
});
