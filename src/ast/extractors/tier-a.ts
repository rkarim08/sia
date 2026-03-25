// Module: tier-a — Full structural extraction for 15 Tier A languages

import { basename } from "node:path";
import type { CandidateFact } from "@/capture/types";

/** Regex patterns grouped by extraction category for a single language. */
interface LanguagePatterns {
	functions: RegExp[];
	classes: RegExp[];
	imports: RegExp[];
	calls: RegExp[];
}

/** Return 3 surrounding lines around a match index for context. */
function surroundingLines(content: string, matchIndex: number): string {
	const before = content.lastIndexOf("\n", matchIndex);
	const lineStart = before === -1 ? 0 : before + 1;
	let end = matchIndex;
	for (let i = 0; i < 3; i++) {
		const next = content.indexOf("\n", end + 1);
		if (next === -1) {
			end = content.length;
			break;
		}
		end = next;
	}
	return content.slice(lineStart, end).trim();
}

// ---------- Tier A pattern table ----------

const tsPatterns: LanguagePatterns = {
	functions: [
		/(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
		/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/gm,
	],
	classes: [
		/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
		/(?:export\s+)?interface\s+(\w+)/gm,
		/(?:export\s+)?type\s+(\w+)\s*[<=]/gm,
		/(?:export\s+)?enum\s+(\w+)/gm,
	],
	imports: [
		/import\s+\{\s*(\w+)/gm,
		/import\s+\*\s+as\s+(\w+)/gm,
		/import\s+(\w+)\s+from\s+/gm,
		/require\s*\(\s*["']([^"']+)["']\s*\)/gm,
	],
	calls: [
		/(?<![.\w])(\w+)\s*\(/gm,
		/\.(\w+)\s*\(/gm,
		/new\s+(\w+)\s*\(/gm,
	],
};

const jsPatterns: LanguagePatterns = {
	functions: tsPatterns.functions,
	classes: [/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm, /(?:export\s+)?enum\s+(\w+)/gm],
	imports: tsPatterns.imports,
	calls: tsPatterns.calls,
};

const pythonPatterns: LanguagePatterns = {
	functions: [/(?:async\s+)?def\s+(\w+)/gm],
	classes: [/^class\s+(\w+)/gm],
	imports: [
		/from\s+\S+\s+import\s+(\w+)/gm,
		/^import\s+(\w+)/gm,
	],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const goPatterns: LanguagePatterns = {
	functions: [/func\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s+)?(\w+)/gm],
	classes: [/type\s+(\w+)\s+struct/gm, /type\s+(\w+)\s+interface/gm],
	imports: [/^\s*"([^"]+)"/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const rustPatterns: LanguagePatterns = {
	functions: [/(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm],
	classes: [
		/(?:pub\s+)?struct\s+(\w+)/gm,
		/(?:pub\s+)?enum\s+(\w+)/gm,
		/(?:pub\s+)?trait\s+(\w+)/gm,
		/impl(?:<[^>]+>)?\s+(\w+)/gm,
	],
	imports: [/use\s+[\w:]+::(\w+)/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm, /(\w+)!/gm],
};

const javaPatterns: LanguagePatterns = {
	functions: [
		/(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\(/gm,
	],
	classes: [
		/(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/gm,
		/(?:public\s+)?interface\s+(\w+)/gm,
		/(?:public\s+)?enum\s+(\w+)/gm,
	],
	imports: [/import\s+[\w.]+\.(\w+)\s*;/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const kotlinPatterns: LanguagePatterns = {
	functions: [/fun\s+(?:<[^>]+>\s+)?(\w+)/gm],
	classes: [
		/(?:data\s+)?class\s+(\w+)/gm,
		/interface\s+(\w+)/gm,
		/object\s+(\w+)/gm,
		/enum\s+class\s+(\w+)/gm,
	],
	imports: [/import\s+[\w.]+\.(\w+)/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const swiftPatterns: LanguagePatterns = {
	functions: [/func\s+(\w+)/gm],
	classes: [
		/class\s+(\w+)/gm,
		/struct\s+(\w+)/gm,
		/enum\s+(\w+)/gm,
		/protocol\s+(\w+)/gm,
	],
	imports: [/import\s+(\w+)/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const phpPatterns: LanguagePatterns = {
	functions: [/function\s+(\w+)/gm],
	classes: [
		/class\s+(\w+)/gm,
		/interface\s+(\w+)/gm,
		/trait\s+(\w+)/gm,
	],
	imports: [/use\s+[\w\\]+\\(\w+)/gm],
	calls: [/(?<![.\w$])(\w+)\s*\(/gm, /->(\w+)\s*\(/gm, /::(\w+)\s*\(/gm],
};

const rubyPatterns: LanguagePatterns = {
	functions: [/def\s+(\w+)/gm],
	classes: [/class\s+(\w+)/gm, /module\s+(\w+)/gm],
	imports: [/require\s+['"]([^'"]+)['"]/gm, /require_relative\s+['"]([^'"]+)['"]/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*[(\s]/gm],
};

const scalaPatterns: LanguagePatterns = {
	functions: [/def\s+(\w+)/gm],
	classes: [/(?:case\s+)?class\s+(\w+)/gm, /object\s+(\w+)/gm, /trait\s+(\w+)/gm],
	imports: [/import\s+[\w.]+\.(\w+)/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const elixirPatterns: LanguagePatterns = {
	functions: [/\b(?:def|defp)\s+(\w+)/gm],
	classes: [/defmodule\s+([\w.]+)/gm],
	imports: [/\bimport\s+([\w.]+)/gm, /\balias\s+([\w.]+)/gm, /\buse\s+([\w.]+)/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const dartPatterns: LanguagePatterns = {
	functions: [
		/(?:void|int|double|bool|String|dynamic|Future|Stream|List|Map|Set|\w+)\s+(\w+)\s*\(/gm,
	],
	classes: [/(?:abstract\s+)?class\s+(\w+)/gm, /mixin\s+(\w+)/gm, /extension\s+(\w+)/gm],
	imports: [/import\s+['"]([^'"]+)['"]/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

// ---------- Extension to (language name, patterns) mapping ----------

const TIER_A_PATTERNS: Record<string, { language: string; patterns: LanguagePatterns }> = {
	".ts": { language: "typescript", patterns: tsPatterns },
	".tsx": { language: "tsx", patterns: tsPatterns },
	".js": { language: "javascript", patterns: jsPatterns },
	".mjs": { language: "javascript", patterns: jsPatterns },
	".cjs": { language: "javascript", patterns: jsPatterns },
	".jsx": { language: "jsx", patterns: jsPatterns },
	".py": { language: "python", patterns: pythonPatterns },
	".go": { language: "go", patterns: goPatterns },
	".rs": { language: "rust", patterns: rustPatterns },
	".java": { language: "java", patterns: javaPatterns },
	".kt": { language: "kotlin", patterns: kotlinPatterns },
	".kts": { language: "kotlin", patterns: kotlinPatterns },
	".swift": { language: "swift", patterns: swiftPatterns },
	".php": { language: "php", patterns: phpPatterns },
	".rb": { language: "ruby", patterns: rubyPatterns },
	".scala": { language: "scala", patterns: scalaPatterns },
	".ex": { language: "elixir", patterns: elixirPatterns },
	".exs": { language: "elixir", patterns: elixirPatterns },
	".dart": { language: "dart", patterns: dartPatterns },
};

type Category = "function" | "class" | "import" | "call";

const CATEGORIES: { key: keyof LanguagePatterns; category: Category }[] = [
	{ key: "functions", category: "function" },
	{ key: "classes", category: "class" },
	{ key: "imports", category: "import" },
	{ key: "calls", category: "call" },
];

// Common keywords and stdlib/utility names to exclude from call extraction.
// These would create noise nodes with no structural value.
const CALL_NOISE = new Set([
	// Language keywords
	"if", "for", "while", "switch", "catch", "return", "throw",
	"typeof", "instanceof", "void", "delete", "await", "else",
	"case", "break", "continue", "do", "in", "of",
	"let", "const", "var", "true", "false", "null", "undefined",
	"try", "finally", "yield", "import", "export", "from",
	"require", "include", "require_once", "include_once",
	"def", "class", "fn", "func", "fun", "function",
	"pub", "async", "self", "super", "this", "new",
	"use", "mod", "type", "interface", "enum", "struct",
	"trait", "impl", "where", "match", "loop",
	"print", "println", "printf", "fmt", "defmodule", "defp",
	// JS/TS stdlib — Array/Object/String methods
	"map", "filter", "reduce", "forEach", "some", "every", "find",
	"findIndex", "includes", "indexOf", "lastIndexOf", "flat", "flatMap",
	"push", "pop", "shift", "unshift", "splice", "slice", "concat",
	"sort", "reverse", "fill", "join", "entries", "keys", "values",
	"assign", "freeze", "create", "defineProperty", "getOwnPropertyNames",
	"hasOwnProperty", "toString", "valueOf", "toJSON",
	"startsWith", "endsWith", "trim", "trimStart", "trimEnd",
	"split", "replace", "replaceAll", "charAt", "charCodeAt",
	"substring", "toLowerCase", "toUpperCase", "padStart", "padEnd",
	"stringify", "parse", "isArray", "isNaN", "isFinite",
	"parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent",
	// Map/Set methods
	"set", "get", "has", "delete", "clear", "add", "size",
	// Promise methods
	"then", "catch", "finally", "resolve", "reject", "all", "allSettled", "race",
	// Console/logging
	"log", "warn", "error", "info", "debug", "trace", "assert",
	"console", "process",
	// Node.js fs
	"readFileSync", "writeFileSync", "existsSync", "mkdirSync", "mkdtempSync",
	"rmSync", "statSync", "readdirSync", "appendFileSync", "unlinkSync",
	"readFile", "writeFile", "mkdir", "stat", "readdir", "unlink",
	// Node.js path
	"basename", "dirname", "extname", "relative", "normalize", "isAbsolute",
	// Node.js crypto
	"createHash", "randomUUID", "randomBytes", "update", "digest",
	// Node.js os
	"cpus", "tmpdir", "homedir", "platform", "arch",
	// Node.js child_process
	"execFileSync", "spawn", "fork",
	// Node.js events
	"on", "once", "emit", "removeListener", "removeAllListeners",
	// DOM / Web APIs
	"getElementById", "querySelector", "querySelectorAll",
	"createElement", "appendChild", "removeChild", "addEventListener",
	"removeEventListener", "setAttribute", "getAttribute",
	"setTimeout", "setInterval", "clearTimeout", "clearInterval",
	"fetch", "abort", "signal",
	// Test framework
	"describe", "it", "test", "expect", "beforeEach", "afterEach",
	"beforeAll", "afterAll", "vi", "jest", "mock", "spy",
	"toBe", "toEqual", "toContain", "toHaveLength", "toBeDefined",
	"toBeNull", "toBeUndefined", "toBeGreaterThan", "toThrow",
	"toBeGreaterThanOrEqual", "toBeLessThan", "toHaveBeenCalled",
	"toHaveBeenCalledWith", "toMatchObject", "toMatchSnapshot",
	// Common generic names
	"close", "open", "read", "write", "end", "done", "next",
	"callback", "cb", "err", "data", "result", "response", "request",
	"length", "count", "now", "Date", "Math", "Number", "String",
	"Boolean", "Array", "Object", "RegExp", "Error", "Map", "Set",
	"Promise", "Symbol", "Buffer", "URL", "JSON",
]);

/**
 * Extract structural code entities from file content using language-specific
 * regex patterns. Supports all 15 Tier A languages.
 *
 * Only functions, classes, interfaces, types, and enums become first-class
 * entities. Imports and calls are captured as proposed_relationships (edges)
 * attached to the file's function/class entities — not as standalone nodes.
 */
export function extractTierA(content: string, filePath: string): CandidateFact[] {
	if (!content || !filePath) return [];

	const dotIdx = filePath.lastIndexOf(".");
	if (dotIdx === -1) return [];

	const ext = filePath.slice(dotIdx);
	const entry = TIER_A_PATTERNS[ext];
	if (!entry) return [];

	const { language, patterns } = entry;
	const base = basename(filePath);
	const facts: CandidateFact[] = [];
	const seen = new Set<string>();
	const declPositions = new Set<number>();

	// Imports and calls don't create standalone entities — they accumulate as
	// proposed_relationships and get attached to the file's function/class entities.
	const importRelationships: Array<{ target_name: string; type: string; weight: number }> = [];
	const callRelationships: Array<{ target_name: string; type: string; weight: number }> = [];

	for (const { key, category } of CATEGORIES) {
		const regexes = patterns[key];
		for (const regex of regexes) {
			regex.lastIndex = 0;

			let m: RegExpExecArray | null = regex.exec(content);
			while (m !== null) {
				const name = m[1];
				if (!name) {
					m = regex.exec(content);
					continue;
				}

				if (category === "call" && CALL_NOISE.has(name)) {
					m = regex.exec(content);
					continue;
				}

				if (category === "call") {
					const nameStart = m.index + m[0].indexOf(name);
					if (declPositions.has(nameStart)) {
						m = regex.exec(content);
						continue;
					}
				}

				const dedupeKey = `${category}:${name}`;
				if (seen.has(dedupeKey)) {
					m = regex.exec(content);
					continue;
				}
				seen.add(dedupeKey);

				if (category === "function" || category === "class") {
					const nameStart = m.index + m[0].indexOf(name);
					declPositions.add(nameStart);
				}

				// Imports: don't create entities, just collect edge relationships
				if (category === "import") {
					const lineEnd = content.indexOf("\n", m.index);
					const line = content.slice(m.index, lineEnd === -1 ? undefined : lineEnd);
					const fromMatch = /from\s+["']([^"']+)["']/.exec(line);
					const reqMatch = /require\s*\(\s*["']([^"']+)["']\s*\)/.exec(line);
					const sourceMod = fromMatch?.[1] ?? reqMatch?.[1];
					if (sourceMod) {
						importRelationships.push({ target_name: sourceMod, type: "imports", weight: 0.9 });
					}
					m = regex.exec(content);
					continue;
				}

				// Calls: don't create entities, just collect edge relationships
				if (category === "call") {
					callRelationships.push({ target_name: name, type: "calls", weight: 0.7 });
					m = regex.exec(content);
					continue;
				}

				// Functions, classes, interfaces, types, enums: create entities
				const context = surroundingLines(content, m.index);
				facts.push({
					type: "CodeEntity",
					name,
					content: context,
					summary: `${category} ${name} in ${base}`,
					tags: [language, category],
					file_paths: [filePath],
					trust_tier: 2,
					confidence: 0.92,
					extraction_method: "regex-ast",
				});

				m = regex.exec(content);
			}
		}
	}

	// Attach import/call relationships to all function/class entities in this file.
	// This creates edges between functions and their dependencies without noise nodes.
	const allRelationships = [...importRelationships, ...callRelationships];
	if (allRelationships.length > 0) {
		for (const fact of facts) {
			fact.proposed_relationships = [
				...(fact.proposed_relationships ?? []),
				...allRelationships,
			];
		}
	}

	return facts;
}
