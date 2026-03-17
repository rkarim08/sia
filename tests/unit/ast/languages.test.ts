import { describe, expect, it } from "vitest";
import {
	type LanguageConfig,
	type LanguageRegistry,
	LANGUAGE_REGISTRY,
	getLanguageByExtension,
	mergeAdditionalLanguages,
} from "@/ast/languages";

/** Helper: collect all languages from registry by tier */
function byTier(tier: string, registry: LanguageRegistry = LANGUAGE_REGISTRY): LanguageConfig[] {
	return Object.values(registry).filter((l) => l.tier === tier);
}

describe("languages registry", () => {
	// ---- Tier counts ----

	it("contains all 15 Tier A languages", () => {
		const tierA = byTier("A");
		expect(tierA).toHaveLength(15);

		const names = tierA.map((l) => l.name).sort();
		expect(names).toEqual([
			"dart",
			"elixir",
			"go",
			"java",
			"javascript",
			"jsx",
			"kotlin",
			"php",
			"python",
			"ruby",
			"rust",
			"scala",
			"swift",
			"tsx",
			"typescript",
		]);
	});

	it("contains all 10 Tier B languages", () => {
		const tierB = byTier("B");
		expect(tierB).toHaveLength(10);

		const names = tierB.map((l) => l.name).sort();
		expect(names).toEqual([
			"bash",
			"c",
			"cpp",
			"csharp",
			"haskell",
			"lua",
			"ocaml",
			"perl",
			"r",
			"zig",
		]);
	});

	it("contains Tier C languages (sql, prisma)", () => {
		const tierC = byTier("C");
		expect(tierC).toHaveLength(2);

		const names = tierC.map((l) => l.name).sort();
		expect(names).toEqual(["prisma", "sql"]);
	});

	it("contains Tier D languages (cargo_toml, go_mod, pyproject)", () => {
		const tierD = byTier("D");
		expect(tierD).toHaveLength(3);

		const names = tierD.map((l) => l.name).sort();
		expect(names).toEqual(["cargo_toml", "go_mod", "pyproject"]);
	});

	// ---- Special handling ----

	it("C has specialHandling c-include-paths", () => {
		const c = LANGUAGE_REGISTRY["c"];
		expect(c).toBeDefined();
		expect(c.specialHandling).toBe("c-include-paths");
	});

	it("C++ has specialHandling c-include-paths", () => {
		const cpp = LANGUAGE_REGISTRY["cpp"];
		expect(cpp).toBeDefined();
		expect(cpp.specialHandling).toBe("c-include-paths");
	});

	// ---- Required fields ----

	it("all entries have required fields (name, extensions, treeSitterGrammar, tier, extractors)", () => {
		for (const [key, lang] of Object.entries(LANGUAGE_REGISTRY)) {
			expect(lang.name, `${key} missing name`).toBeTruthy();
			expect(Array.isArray(lang.extensions), `${key} extensions not array`).toBe(true);
			expect(lang.extensions.length, `${key} has no extensions`).toBeGreaterThan(0);
			expect(lang.treeSitterGrammar, `${key} missing treeSitterGrammar`).toBeTruthy();
			expect(["A", "B", "C", "D"], `${key} has invalid tier`).toContain(lang.tier);
			expect(lang.extractors, `${key} missing extractors`).toBeDefined();
			expect(typeof lang.extractors.functions).toBe("boolean");
			expect(typeof lang.extractors.classes).toBe("boolean");
			expect(typeof lang.extractors.imports).toBe("boolean");
			expect(typeof lang.extractors.calls).toBe("boolean");
		}
	});

	// ---- getLanguageByExtension ----

	it("getLanguageByExtension resolves .ts to typescript", () => {
		const result = getLanguageByExtension(".ts");
		expect(result).not.toBeNull();
		expect(result!.name).toBe("typescript");
		expect(result!.tier).toBe("A");
	});

	it("getLanguageByExtension resolves .py to python", () => {
		const result = getLanguageByExtension(".py");
		expect(result).not.toBeNull();
		expect(result!.name).toBe("python");
		expect(result!.tier).toBe("A");
	});

	it("getLanguageByExtension returns null for unknown extension", () => {
		const result = getLanguageByExtension(".xyz_unknown");
		expect(result).toBeNull();
	});

	// ---- mergeAdditionalLanguages ----

	it("mergeAdditionalLanguages adds a new language", () => {
		const registry: LanguageRegistry = { ...LANGUAGE_REGISTRY };
		mergeAdditionalLanguages(registry, [
			{ name: "crystal", extensions: [".cr"], grammar: "tree-sitter-crystal", tier: "B" },
		]);

		expect(registry["crystal"]).toBeDefined();
		expect(registry["crystal"].name).toBe("crystal");
		expect(registry["crystal"].tier).toBe("B");
		expect(registry["crystal"].treeSitterGrammar).toBe("tree-sitter-crystal");
	});

	it("mergeAdditionalLanguages resolves added language by extension", () => {
		const registry: LanguageRegistry = { ...LANGUAGE_REGISTRY };
		mergeAdditionalLanguages(registry, [
			{ name: "crystal", extensions: [".cr"], grammar: "tree-sitter-crystal", tier: "B" },
		]);

		const result = getLanguageByExtension(".cr", registry);
		expect(result).not.toBeNull();
		expect(result!.name).toBe("crystal");
	});

	it("mergeAdditionalLanguages does not overwrite existing language", () => {
		const registry: LanguageRegistry = { ...LANGUAGE_REGISTRY };
		const originalGrammar = registry["typescript"].treeSitterGrammar;

		mergeAdditionalLanguages(registry, [
			{
				name: "typescript",
				extensions: [".ts"],
				grammar: "my-custom-ts-grammar",
				tier: "A",
			},
		]);

		// Should still have the original grammar, not overwritten
		expect(registry["typescript"].treeSitterGrammar).toBe(originalGrammar);
	});
});
