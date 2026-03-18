// Module: tier-b — Structural extraction (no call tracking) for 10 Tier B languages

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

// ---------- Tier B pattern table ----------

const cPatterns: LanguagePatterns = {
	functions: [
		// return_type name( — covers int main(, void foo(, char* bar(
		/(?:unsigned\s+)?(?:void|int|char|float|double|long|short|size_t|bool|(?:struct\s+)?\w+)\s*\*?\s+(\w+)\s*\(/gm,
	],
	classes: [
		/\bstruct\s+(\w+)/gm,
		/\btypedef\s+(?:struct|union|enum)\s*\{[^}]*\}\s*(\w+)/gm,
		/\bunion\s+(\w+)/gm,
	],
	imports: [
		// #include <header.h> or #include "header.h"
		/#include\s+[<"]([^>"]+)[>"]/gm,
	],
	calls: [],
};

const cppPatterns: LanguagePatterns = {
	functions: [
		// template<...> return_type name(
		/template\s*<[^>]*>\s*(?:\w[\w:*&\s]*)\s+(\w+)\s*\(/gm,
		// return_type Class::method(
		/(?:\w[\w:*&\s]*)\s+\w+::(\w+)\s*\(/gm,
		// standalone: return_type name(
		/(?:unsigned\s+)?(?:void|int|char|float|double|long|short|bool|auto|size_t|std::\w+|(?:struct\s+)?\w+)\s*[*&]?\s+(\w+)\s*\(/gm,
	],
	classes: [/\bclass\s+(\w+)/gm, /\bstruct\s+(\w+)/gm, /\bnamespace\s+(\w+)/gm],
	imports: [/#include\s+[<"]([^>"]+)[>"]/gm, /\busing\s+(?:namespace\s+)?(\w[\w:]*)/gm],
	calls: [],
};

const csharpPatterns: LanguagePatterns = {
	functions: [
		// access_modifier [static] return_type name(
		/(?:public|private|protected|internal)\s+(?:static\s+)?(?:virtual\s+)?(?:override\s+)?(?:async\s+)?(?:\w+(?:<[^>]*>)?)\s+(\w+)\s*\(/gm,
	],
	classes: [
		/(?:public\s+|private\s+|protected\s+|internal\s+)?(?:static\s+)?(?:abstract\s+)?(?:sealed\s+)?class\s+(\w+)/gm,
		/(?:public\s+|private\s+|protected\s+|internal\s+)?interface\s+(\w+)/gm,
		/(?:public\s+|private\s+|protected\s+|internal\s+)?struct\s+(\w+)/gm,
		/(?:public\s+|private\s+|protected\s+|internal\s+)?enum\s+(\w+)/gm,
	],
	imports: [
		// using System; or using System.Collections.Generic;
		/^using\s+([\w.]+)\s*;/gm,
	],
	calls: [],
};

const bashPatterns: LanguagePatterns = {
	functions: [
		// function name { or function name() {
		/\bfunction\s+(\w+)/gm,
		// name() { — shorthand
		/^(\w+)\s*\(\s*\)\s*\{/gm,
	],
	classes: [],
	imports: [
		// source path or . path
		/\bsource\s+(\S+)/gm,
		/^\.\s+(\S+)/gm,
	],
	calls: [],
};

const luaPatterns: LanguagePatterns = {
	functions: [
		// function name(
		/\bfunction\s+(\w+)\s*\(/gm,
		// local function name(
		/\blocal\s+function\s+(\w+)\s*\(/gm,
	],
	classes: [],
	imports: [
		// require("name") or require("dotted.path")
		/\brequire\s*\(\s*["']([^"']+)["']\s*\)/gm,
	],
	calls: [],
};

const zigPatterns: LanguagePatterns = {
	functions: [
		// pub fn name or fn name
		/(?:pub\s+)?fn\s+(\w+)/gm,
	],
	classes: [
		// const Name = struct/enum/union
		/\b(\w+)\s*=\s*(?:packed\s+)?(?:struct|enum|union)/gm,
	],
	imports: [
		// @import("name")
		/@import\s*\(\s*["']([^"']+)["']\s*\)/gm,
	],
	calls: [],
};

const perlPatterns: LanguagePatterns = {
	functions: [/\bsub\s+(\w+)/gm],
	classes: [
		// package Name or package Name::Sub
		/\bpackage\s+([\w:]+)/gm,
	],
	imports: [
		// use Module; or use Module::Sub;
		/\buse\s+([\w:]+)/gm,
		// require "file" or require Module
		/\brequire\s+["']([^"']+)["']/gm,
	],
	calls: [],
};

const rPatterns: LanguagePatterns = {
	functions: [
		// name <- function(
		/(\w+)\s*<-\s*function\s*\(/gm,
		// name = function(
		/(\w+)\s*=\s*function\s*\(/gm,
	],
	classes: [/\bsetClass\s*\(\s*["'](\w+)["']/gm, /\bR6Class\s*\(\s*["'](\w+)["']/gm],
	imports: [/\blibrary\s*\(\s*(\w+)\s*\)/gm, /\brequire\s*\(\s*(\w+)\s*\)/gm],
	calls: [],
};

const ocamlPatterns: LanguagePatterns = {
	functions: [
		// let rec name ... = or let name ... =
		/\blet\s+rec\s+(\w+)/gm,
		/\blet\s+(\w+)\b.*(?::|=)/gm,
		// val name : (in .mli)
		/\bval\s+(\w+)\s*:/gm,
	],
	classes: [
		// module Name or module type Name
		/\bmodule\s+(?:type\s+)?(\w+)/gm,
		// type name
		/\btype\s+(\w+)/gm,
	],
	imports: [/\bopen\s+([\w.]+)/gm],
	calls: [],
};

const haskellPatterns: LanguagePatterns = {
	functions: [
		// type signature: name :: Type
		/^(\w+)\s*::\s*.+$/gm,
	],
	classes: [
		/\bdata\s+(\w+)/gm,
		/\bnewtype\s+(\w+)/gm,
		/\bclass\s+(?:\([^)]*\)\s*=>)?\s*(\w+)/gm,
		/\binstance\s+(?:\([^)]*\)\s*=>)?\s*(\w+)/gm,
	],
	imports: [
		// import [qualified] Module.Name [as X]
		/\bimport\s+(?:qualified\s+)?([\w.]+)/gm,
	],
	calls: [],
};

// ---------- Extension to (language name, patterns) mapping ----------

const TIER_B_PATTERNS: Record<string, { language: string; patterns: LanguagePatterns }> = {
	".c": { language: "c", patterns: cPatterns },
	".h": { language: "c", patterns: cPatterns },
	".cpp": { language: "cpp", patterns: cppPatterns },
	".cc": { language: "cpp", patterns: cppPatterns },
	".cxx": { language: "cpp", patterns: cppPatterns },
	".hpp": { language: "cpp", patterns: cppPatterns },
	".hxx": { language: "cpp", patterns: cppPatterns },
	".cs": { language: "csharp", patterns: csharpPatterns },
	".sh": { language: "bash", patterns: bashPatterns },
	".bash": { language: "bash", patterns: bashPatterns },
	".lua": { language: "lua", patterns: luaPatterns },
	".zig": { language: "zig", patterns: zigPatterns },
	".pl": { language: "perl", patterns: perlPatterns },
	".pm": { language: "perl", patterns: perlPatterns },
	".r": { language: "r", patterns: rPatterns },
	".R": { language: "r", patterns: rPatterns },
	".ml": { language: "ocaml", patterns: ocamlPatterns },
	".mli": { language: "ocaml", patterns: ocamlPatterns },
	".hs": { language: "haskell", patterns: haskellPatterns },
};

// Categories for pattern extraction — must match LanguagePatterns keys
// Tier B omits "call" since calls: [] for all languages.
type Category = "function" | "class" | "import";

const CATEGORIES: { key: keyof LanguagePatterns; category: Category }[] = [
	{ key: "functions", category: "function" },
	{ key: "classes", category: "class" },
	{ key: "imports", category: "import" },
];

/**
 * Extract structural code entities from file content using language-specific
 * regex patterns. Supports all 10 Tier B languages. No call extraction.
 *
 * @param content  The file text to scan.
 * @param filePath Path used to determine language by extension.
 * @returns An array of CandidateFact objects for every matched entity.
 */
export function extractTierB(content: string, filePath: string): CandidateFact[] {
	if (!content || !filePath) return [];

	const dotIdx = filePath.lastIndexOf(".");
	if (dotIdx === -1) return [];

	const ext = filePath.slice(dotIdx);
	const entry = TIER_B_PATTERNS[ext];
	if (!entry) return [];

	const { language, patterns } = entry;
	const base = basename(filePath);
	const facts: CandidateFact[] = [];
	const seen = new Set<string>();

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

				// Deduplicate by name + category
				const dedupeKey = `${category}:${name}`;
				if (seen.has(dedupeKey)) {
					m = regex.exec(content);
					continue;
				}
				seen.add(dedupeKey);

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
					extraction_method: "tree-sitter",
				});

				m = regex.exec(content);
			}
		}
	}

	return facts;
}
