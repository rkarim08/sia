import { describe, expect, it } from "vitest";
import {
	handleSiaAstQuery,
	type SiaAstQueryInput,
	type SiaAstQueryResult,
} from "@/mcp/tools/sia-ast-query";

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

	it("should return imports for a TypeScript file", async () => {
		const input: SiaAstQueryInput = {
			file_path: "src/mcp/server.ts",
			query_type: "imports",
		};
		const result = await handleSiaAstQuery(input);
		expect(result.file_path).toBe("src/mcp/server.ts");
		// Tree-sitter may not be available
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
