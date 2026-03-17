// Module: languages — Language registry for AST extraction
import { basename, extname } from "node:path";
import type { AdditionalLanguage } from "@/shared/config";

/** Extraction tier: A = full, B = partial, C = schema-only, D = manifest */
export type ExtractionTier = "A" | "B" | "C" | "D";

/** Special handling hints for certain languages */
export type SpecialHandling =
	| "c-include-paths"
	| "csharp-project"
	| "sql-schema"
	| "prisma-schema"
	| "project-manifest";

/** Extractor capabilities for a language */
export interface Extractors {
	functions: boolean;
	classes: boolean;
	imports: boolean;
	calls: boolean;
}

/** Full language configuration */
export interface LanguageConfig {
	name: string;
	extensions: string[];
	treeSitterGrammar: string;
	tier: ExtractionTier;
	extractors: Extractors;
	specialHandling?: SpecialHandling;
}

/** The canonical language registry keyed by language name */
export type LanguageRegistry = Record<string, LanguageConfig>;

// ---------- Tier A (15 languages) ----------
// All have functions: true, imports: true, calls: true
// All have classes: true except go, rust, elixir

const TIER_A: LanguageConfig[] = [
	{
		name: "typescript",
		extensions: [".ts"],
		treeSitterGrammar: "tree-sitter-typescript",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
	{
		name: "tsx",
		extensions: [".tsx"],
		treeSitterGrammar: "tree-sitter-tsx",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
	{
		name: "javascript",
		extensions: [".js", ".mjs", ".cjs"],
		treeSitterGrammar: "tree-sitter-javascript",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
	{
		name: "jsx",
		extensions: [".jsx"],
		treeSitterGrammar: "tree-sitter-javascript",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
	{
		name: "python",
		extensions: [".py"],
		treeSitterGrammar: "tree-sitter-python",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
	{
		name: "go",
		extensions: [".go"],
		treeSitterGrammar: "tree-sitter-go",
		tier: "A",
		extractors: { functions: true, classes: false, imports: true, calls: true },
	},
	{
		name: "rust",
		extensions: [".rs"],
		treeSitterGrammar: "tree-sitter-rust",
		tier: "A",
		extractors: { functions: true, classes: false, imports: true, calls: true },
	},
	{
		name: "java",
		extensions: [".java"],
		treeSitterGrammar: "tree-sitter-java",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
	{
		name: "kotlin",
		extensions: [".kt", ".kts"],
		treeSitterGrammar: "tree-sitter-kotlin",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
	{
		name: "swift",
		extensions: [".swift"],
		treeSitterGrammar: "tree-sitter-swift",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
	{
		name: "php",
		extensions: [".php"],
		treeSitterGrammar: "tree-sitter-php",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
	{
		name: "ruby",
		extensions: [".rb"],
		treeSitterGrammar: "tree-sitter-ruby",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
	{
		name: "scala",
		extensions: [".scala"],
		treeSitterGrammar: "tree-sitter-scala",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
	{
		name: "elixir",
		extensions: [".ex", ".exs"],
		treeSitterGrammar: "tree-sitter-elixir",
		tier: "A",
		extractors: { functions: true, classes: false, imports: true, calls: true },
	},
	{
		name: "dart",
		extensions: [".dart"],
		treeSitterGrammar: "tree-sitter-dart",
		tier: "A",
		extractors: { functions: true, classes: true, imports: true, calls: true },
	},
];

// ---------- Tier B (10 languages) ----------
// All have calls: false. Most have classes: false except cpp and csharp.

const TIER_B: LanguageConfig[] = [
	{
		name: "c",
		extensions: [".c", ".h"],
		treeSitterGrammar: "tree-sitter-c",
		tier: "B",
		extractors: { functions: true, classes: false, imports: true, calls: false },
		specialHandling: "c-include-paths",
	},
	{
		name: "cpp",
		extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h++"],
		treeSitterGrammar: "tree-sitter-cpp",
		tier: "B",
		extractors: { functions: true, classes: true, imports: true, calls: false },
		specialHandling: "c-include-paths",
	},
	{
		name: "csharp",
		extensions: [".cs"],
		treeSitterGrammar: "tree-sitter-c-sharp",
		tier: "B",
		extractors: { functions: true, classes: true, imports: true, calls: false },
		specialHandling: "csharp-project",
	},
	{
		name: "bash",
		extensions: [".sh", ".bash", ".zsh", ".fish"],
		treeSitterGrammar: "tree-sitter-bash",
		tier: "B",
		extractors: { functions: true, classes: false, imports: true, calls: false },
	},
	{
		name: "lua",
		extensions: [".lua"],
		treeSitterGrammar: "tree-sitter-lua",
		tier: "B",
		extractors: { functions: true, classes: false, imports: true, calls: false },
	},
	{
		name: "zig",
		extensions: [".zig"],
		treeSitterGrammar: "tree-sitter-zig",
		tier: "B",
		extractors: { functions: true, classes: false, imports: true, calls: false },
	},
	{
		name: "r",
		extensions: [".r", ".R"],
		treeSitterGrammar: "tree-sitter-r",
		tier: "B",
		extractors: { functions: true, classes: false, imports: true, calls: false },
	},
	{
		name: "ocaml",
		extensions: [".ml", ".mli"],
		treeSitterGrammar: "tree-sitter-ocaml",
		tier: "B",
		extractors: { functions: true, classes: false, imports: true, calls: false },
	},
	{
		name: "haskell",
		extensions: [".hs", ".lhs"],
		treeSitterGrammar: "tree-sitter-haskell",
		tier: "B",
		extractors: { functions: true, classes: false, imports: true, calls: false },
	},
	{
		name: "perl",
		extensions: [".pl", ".pm"],
		treeSitterGrammar: "tree-sitter-perl",
		tier: "B",
		extractors: { functions: true, classes: false, imports: true, calls: false },
	},
];

// ---------- Tier C (2 languages) ----------

const TIER_C: LanguageConfig[] = [
	{
		name: "sql",
		extensions: [".sql"],
		treeSitterGrammar: "tree-sitter-sql",
		tier: "C",
		extractors: { functions: false, classes: false, imports: false, calls: false },
		specialHandling: "sql-schema",
	},
	{
		name: "prisma",
		extensions: [".prisma"],
		treeSitterGrammar: "tree-sitter-prisma",
		tier: "C",
		extractors: { functions: false, classes: false, imports: false, calls: false },
		specialHandling: "prisma-schema",
	},
];

// ---------- Tier D (3 languages) ----------

const TIER_D: LanguageConfig[] = [
	{
		name: "cargo_toml",
		extensions: ["Cargo.toml"],
		treeSitterGrammar: "tree-sitter-toml",
		tier: "D",
		extractors: { functions: false, classes: false, imports: false, calls: false },
		specialHandling: "project-manifest",
	},
	{
		name: "go_mod",
		extensions: ["go.mod"],
		treeSitterGrammar: "tree-sitter-gomod",
		tier: "D",
		extractors: { functions: false, classes: false, imports: false, calls: false },
		specialHandling: "project-manifest",
	},
	{
		name: "pyproject",
		extensions: ["pyproject.toml", "setup.py", "setup.cfg"],
		treeSitterGrammar: "tree-sitter-toml",
		tier: "D",
		extractors: { functions: false, classes: false, imports: false, calls: false },
		specialHandling: "project-manifest",
	},
];

/** The complete language registry (30 languages) */
export const LANGUAGE_REGISTRY: LanguageRegistry = {};

// Populate the registry from the tier arrays
for (const lang of [...TIER_A, ...TIER_B, ...TIER_C, ...TIER_D]) {
	LANGUAGE_REGISTRY[lang.name] = lang;
}

// ---------- Extension lookup cache ----------

let extensionCache: Map<string, LanguageConfig> | null = null;

function buildExtensionCache(registry: LanguageRegistry): Map<string, LanguageConfig> {
	const cache = new Map<string, LanguageConfig>();
	for (const lang of Object.values(registry)) {
		for (const ext of lang.extensions) {
			cache.set(ext.toLowerCase(), lang);
		}
	}
	return cache;
}

function getCache(registry: LanguageRegistry): Map<string, LanguageConfig> {
	if (registry === LANGUAGE_REGISTRY && extensionCache !== null) {
		return extensionCache;
	}
	const cache = buildExtensionCache(registry);
	if (registry === LANGUAGE_REGISTRY) {
		extensionCache = cache;
	}
	return cache;
}

/**
 * Look up a LanguageConfig by file extension (e.g. ".ts", ".py").
 * Extension should include the leading dot for normal extensions,
 * or be a full filename for manifest files (e.g. "Cargo.toml").
 *
 * Accepts an optional registry for custom/merged registries.
 */
export function getLanguageByExtension(
	ext: string,
	registry: LanguageRegistry = LANGUAGE_REGISTRY,
): LanguageConfig | null {
	const cache = getCache(registry);
	return cache.get(ext.toLowerCase()) ?? null;
}

/**
 * Resolve a file path to its LanguageConfig (convenience wrapper).
 * Handles both extension-based and filename-based lookups (e.g. "Cargo.toml").
 */
export function getLanguageForFile(
	filePath: string,
	registry: LanguageRegistry = LANGUAGE_REGISTRY,
): LanguageConfig | null {
	const base = basename(filePath).toLowerCase();
	const cache = getCache(registry);

	// Try full filename first (for manifests like Cargo.toml, go.mod)
	if (cache.has(base)) {
		return cache.get(base) ?? null;
	}

	// Fall back to extension
	const ext = extname(base);
	if (ext) {
		return cache.get(ext.toLowerCase()) ?? null;
	}

	return null;
}

/**
 * Merge additional languages into a registry.
 * Does NOT overwrite languages that already exist (by name).
 * Invalidates the extension cache so new languages are discoverable.
 */
export function mergeAdditionalLanguages(
	registry: LanguageRegistry,
	additions: AdditionalLanguage[],
): void {
	for (const lang of additions) {
		// Do not overwrite existing languages
		if (registry[lang.name]) {
			continue;
		}

		const tier: ExtractionTier =
			lang.tier === "A" || lang.tier === "B" || lang.tier === "C" || lang.tier === "D"
				? (lang.tier as ExtractionTier)
				: "D";

		const config: LanguageConfig = {
			name: lang.name,
			extensions: lang.extensions.map((e) => e.toLowerCase()),
			treeSitterGrammar: lang.grammar,
			tier,
			extractors: { functions: false, classes: false, imports: false, calls: false },
		};

		registry[lang.name] = config;
	}

	// Invalidate cache so new extensions are picked up
	extensionCache = null;
}
