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
		// export async function name, function name, arrow functions
		/(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
		// const name = (...) => or const name = async (...) =>
		/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/gm,
	],
	classes: [
		/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
		/(?:export\s+)?interface\s+(\w+)/gm,
		/(?:export\s+)?type\s+(\w+)\s*[<=]/gm,
		/(?:export\s+)?enum\s+(\w+)/gm,
	],
	imports: [
		// import { foo } from "bar" — captures the first named import
		/import\s+\{\s*(\w+)/gm,
		// import * as name from "bar"
		/import\s+\*\s+as\s+(\w+)/gm,
		// import name from "bar"
		/import\s+(\w+)\s+from\s+/gm,
		// require("bar")
		/require\s*\(\s*["']([^"']+)["']\s*\)/gm,
	],
	calls: [
		// standalone function call: name(
		/(?<![.\w])(\w+)\s*\(/gm,
		// method call: obj.name( — captures name
		/\.(\w+)\s*\(/gm,
		// new Constructor(
		/new\s+(\w+)\s*\(/gm,
	],
};

// JS is same as TS minus the type keyword pattern
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
		// from module import name — captures name
		/from\s+\S+\s+import\s+(\w+)/gm,
		// import module
		/^import\s+(\w+)/gm,
	],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const goPatterns: LanguagePatterns = {
	functions: [
		// func Name( or func (receiver) Name(
		/func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/gm,
	],
	classes: [/type\s+(\w+)\s+struct\b/gm, /type\s+(\w+)\s+interface\b/gm],
	imports: [
		// Single import: import "pkg"
		/import\s+"([^"]+)"/gm,
		// Grouped imports: each "pkg" line inside import ( ... )
		/^\s+"([^"]+)"/gm,
	],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const rustPatterns: LanguagePatterns = {
	functions: [
		// pub fn name, fn name, pub async fn name, async fn name
		/(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm,
	],
	classes: [
		/(?:pub\s+)?struct\s+(\w+)/gm,
		/(?:pub\s+)?enum\s+(\w+)/gm,
		/(?:pub\s+)?trait\s+(\w+)/gm,
	],
	imports: [
		// use path::Name — captures the last segment
		/use\s+(?:\w+::)*(\w+)/gm,
		// mod name
		/mod\s+(\w+)/gm,
	],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /::(\w+)\s*\(/gm],
};

const javaPatterns: LanguagePatterns = {
	functions: [
		// method: access modifier, optional static/final, return type, name(
		/(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:(?:abstract|synchronized|native)\s+)?(?:\w+(?:<[^>]*>)?)\s+(\w+)\s*\(/gm,
		// default-access methods: returnType name( — at indent
		/^\s+\w+(?:<[^>]*>)?\s+(\w+)\s*\(/gm,
	],
	classes: [
		/(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/gm,
		/(?:public\s+)?interface\s+(\w+)/gm,
		/(?:public\s+)?enum\s+(\w+)/gm,
	],
	imports: [/import\s+(?:static\s+)?[\w.]+\.(\w+)\s*;/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm, /new\s+(\w+)\s*\(/gm],
};

const kotlinPatterns: LanguagePatterns = {
	functions: [/(?:suspend\s+)?fun\s+(?:<[^>]*>\s+)?(\w+)/gm],
	classes: [
		/(?:data\s+)?class\s+(\w+)/gm,
		/object\s+(\w+)/gm,
		/interface\s+(\w+)/gm,
		/enum\s+class\s+(\w+)/gm,
	],
	imports: [/import\s+[\w.]+\.(\w+)/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const swiftPatterns: LanguagePatterns = {
	functions: [/func\s+(\w+)/gm],
	classes: [/class\s+(\w+)/gm, /struct\s+(\w+)/gm, /enum\s+(\w+)/gm, /protocol\s+(\w+)/gm],
	imports: [/import\s+(\w+)/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const phpPatterns: LanguagePatterns = {
	functions: [
		// standalone function
		/^function\s+(\w+)/gm,
		// public/private/protected function
		/(?:public|private|protected)\s+(?:static\s+)?function\s+(\w+)/gm,
	],
	classes: [/(?:abstract\s+)?class\s+(\w+)/gm, /interface\s+(\w+)/gm, /trait\s+(\w+)/gm],
	imports: [
		// use Namespace\Class — captures last segment
		/use\s+[\w\\]+\\(\w+)/gm,
		// require/include variants
		/(?:require|require_once|include|include_once)\s+["']([^"']+)["']/gm,
	],
	calls: [/(?<![.\w$])(\w+)\s*\(/gm, /->(\w+)\s*\(/gm, /::(\w+)\s*\(/gm],
};

const rubyPatterns: LanguagePatterns = {
	functions: [/def\s+(?:self\.)?(\w+)/gm],
	classes: [/class\s+(\w+)/gm, /module\s+(\w+)/gm],
	imports: [
		// require "name" or require 'name'
		/require\s+["']([^"']+)["']/gm,
		// require_relative "path"
		/require_relative\s+["']([^"']+)["']/gm,
	],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const scalaPatterns: LanguagePatterns = {
	functions: [/def\s+(\w+)/gm],
	classes: [/(?:case\s+)?class\s+(\w+)/gm, /object\s+(\w+)/gm, /trait\s+(\w+)/gm],
	imports: [/import\s+[\w.]+\.(\w+)/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const elixirPatterns: LanguagePatterns = {
	functions: [
		// def name or defp name — but not defmodule
		/\b(?:def|defp)\s+(\w+)/gm,
	],
	classes: [
		// defmodule with dotted names
		/defmodule\s+([\w.]+)/gm,
	],
	imports: [/\bimport\s+([\w.]+)/gm, /\balias\s+([\w.]+)/gm, /\buse\s+([\w.]+)/gm],
	calls: [/(?<![.\w])(\w+)\s*\(/gm, /\.(\w+)\s*\(/gm],
};

const dartPatterns: LanguagePatterns = {
	functions: [
		// return-type + name( — void main(, Widget build(
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

// Categories for pattern extraction — must match LanguagePatterns keys
type Category = "function" | "class" | "import" | "call";

const CATEGORIES: { key: keyof LanguagePatterns; category: Category }[] = [
	{ key: "functions", category: "function" },
	{ key: "classes", category: "class" },
	{ key: "imports", category: "import" },
	{ key: "calls", category: "call" },
];

// Common keywords/noise to exclude from call extraction
const CALL_NOISE = new Set([
	"if",
	"for",
	"while",
	"switch",
	"catch",
	"return",
	"throw",
	"typeof",
	"instanceof",
	"void",
	"delete",
	"await",
	"else",
	"case",
	"break",
	"continue",
	"do",
	"in",
	"of",
	"let",
	"const",
	"var",
	"true",
	"false",
	"null",
	"undefined",
	"try",
	"finally",
	"yield",
	"import",
	"export",
	"from",
	"require",
	"include",
	"require_once",
	"include_once",
	"def",
	"class",
	"fn",
	"func",
	"fun",
	"function",
	"pub",
	"async",
	"self",
	"super",
	"this",
	"new",
	"use",
	"mod",
	"type",
	"interface",
	"enum",
	"struct",
	"trait",
	"impl",
	"where",
	"match",
	"loop",
	"print",
	"println",
	"printf",
	"fmt",
	"defmodule",
	"defp",
]);

/**
 * Extract structural code entities from file content using language-specific
 * regex patterns. Supports all 15 Tier A languages.
 *
 * @param content  The file text to scan.
 * @param filePath Path used to determine language by extension.
 * @returns An array of CandidateFact objects for every matched entity.
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

	// Track positions where function/class declarations match so call extraction
	// can skip overlapping positions (avoids treating `function foo()` as a call).
	const declPositions = new Set<number>();

	for (const { key, category } of CATEGORIES) {
		const regexes = patterns[key];
		for (const regex of regexes) {
			// Reset lastIndex so the regex starts from the beginning each time
			regex.lastIndex = 0;

			let m: RegExpExecArray | null = regex.exec(content);
			while (m !== null) {
				const name = m[1];
				if (!name) {
					m = regex.exec(content);
					continue;
				}

				// Skip noise words in call extraction
				if (category === "call" && CALL_NOISE.has(name)) {
					m = regex.exec(content);
					continue;
				}

				// For calls, skip matches whose name starts at a position covered
				// by a function/class declaration match
				if (category === "call") {
					// The capture group starts at m.index + (length of text before group 1)
					const nameStart = m.index + m[0].indexOf(name);
					if (declPositions.has(nameStart)) {
						m = regex.exec(content);
						continue;
					}
				}

				// Deduplicate by name + category
				const dedupeKey = `${category}:${name}`;
				if (seen.has(dedupeKey)) {
					m = regex.exec(content);
					continue;
				}
				seen.add(dedupeKey);

				// Record the name position for function/class declarations
				if (category === "function" || category === "class") {
					const nameStart = m.index + m[0].indexOf(name);
					declPositions.add(nameStart);
				}

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

	return facts;
}
