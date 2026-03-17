import { describe, expect, it } from "vitest";
import { getLanguageForFile, LANGUAGE_REGISTRY, mergeAdditionalLanguages } from "@/ast/languages";

describe("languages registry", () => {
	it("resolves known extensions", () => {
		const ts = getLanguageForFile("foo.ts");
		expect(ts?.name).toBe("TypeScript");
		expect(ts?.tier).toBe("A");

		const manifest = getLanguageForFile("Cargo.toml");
		expect(manifest?.tier).toBe("D");
	});

	it("merges additional languages", () => {
		const sizeBefore = LANGUAGE_REGISTRY.size;
		mergeAdditionalLanguages([
			{ name: "Crystal", extensions: [".cr"], grammar: "tree-sitter-crystal", tier: "B" },
		]);

		const crystal = getLanguageForFile("main.cr");
		expect(crystal?.name).toBe("Crystal");

		LANGUAGE_REGISTRY.delete(".cr");
		expect(LANGUAGE_REGISTRY.size).toBeGreaterThanOrEqual(sizeBefore);
	});
});
