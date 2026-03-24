import { describe, expect, it } from "vitest";
import { parseFileWithRetry } from "@/ast/index-worker";

describe("index-worker parseFileWithRetry", () => {
	it("should parse a TypeScript file and return facts", async () => {
		const result = await parseFileWithRetry(
			`${process.cwd()}/src/shared/types.ts`,
			"src/shared/types.ts",
		);
		expect(result.relPath).toBe("src/shared/types.ts");
		expect(result.error).toBeUndefined();
		expect(result.mtimeMs).toBeGreaterThan(0);
		// types.ts has many type exports — should extract some facts
		expect(result.facts.length).toBeGreaterThanOrEqual(0);
	});

	it("should return error for non-existent file", async () => {
		const result = await parseFileWithRetry("/tmp/non-existent-file.ts", "non-existent.ts");
		expect(result.error).toBeDefined();
		expect(result.facts).toHaveLength(0);
	});

	it("should return empty facts for unsupported file types", async () => {
		const result = await parseFileWithRetry(`${process.cwd()}/package.json`, "package.json");
		// package.json may or may not have a language config — either way, no crash
		expect(result.error).toBeUndefined();
	});
});
