// Module: tier-dispatch — Route file extraction by LanguageConfig.tier

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtractionTier, SpecialHandling } from "@/ast/languages";
import { LANGUAGE_REGISTRY, resolveLanguageConfig } from "@/ast/languages";
import { TreeSitterService } from "@/ast/tree-sitter/service";
import type { CandidateFact } from "@/capture/types";
import { getConfig } from "@/shared/config";
import { extractPrismaSchema } from "./prisma-schema";
import { extractManifest } from "./project-manifest";
import { extractSqlSchema } from "./sql-schema";
import { extractTierA } from "./tier-a";
import { extractTierB } from "./tier-b";

/** Return surrounding lines around a match index for context snippets. */
function surroundingLines(content: string, matchIndex: number, contextLines = 3): string {
	const lines = content.split("\n");
	let charCount = 0;
	let targetLine = 0;
	for (let i = 0; i < lines.length; i++) {
		charCount += lines[i].length + 1;
		if (charCount > matchIndex) {
			targetLine = i;
			break;
		}
	}
	const start = Math.max(0, targetLine - contextLines);
	const end = Math.min(lines.length, targetLine + contextLines + 1);
	return lines.slice(start, end).join("\n");
}

let _service: TreeSitterService | null = null;
function getTreeSitterService(): TreeSitterService {
	if (!_service) {
		const config = getConfig();
		_service = new TreeSitterService(config.treeSitter!);
	}
	return _service;
}

/**
 * Attempt tree-sitter extraction for a file. Returns CandidateFact[] on success,
 * or null if parsing fails (triggers regex fallback).
 */
async function tryTreeSitterExtraction(
	content: string,
	filePath: string,
	langName: string,
): Promise<CandidateFact[] | null> {
	try {
		const service = getTreeSitterService();
		const tree = await service.parse(content, langName);
		if (!tree) return null;

		const langConfig = LANGUAGE_REGISTRY[langName];
		if (!langConfig) return null;

		const resolved = resolveLanguageConfig(langConfig);
		const config = getConfig();
		const queryDir = config.treeSitter?.queryDir;
		if (!queryDir) return null;

		const base = basename(filePath);
		const facts: CandidateFact[] = [];
		const seen = new Set<string>();

		// Run symbols.scm query
		const symbolsPath = join(queryDir, resolved.queryDir, "symbols.scm");
		if (existsSync(symbolsPath)) {
			const matches = service.query(tree, symbolsPath);
			for (const match of matches) {
				for (const cap of match.captures) {
					const category = cap.name.startsWith("function")
						? "function"
						: cap.name.startsWith("class") ||
								cap.name.startsWith("type") ||
								cap.name.startsWith("interface")
							? "class"
							: cap.name;
					const dedupeKey = `${category}:${cap.text}`;
					if (seen.has(dedupeKey)) continue;
					seen.add(dedupeKey);
					facts.push({
						type: "CodeEntity",
						name: cap.text,
						content: surroundingLines(content, cap.startIndex),
						summary: `${category} ${cap.text} in ${base}`,
						tags: [langName, category],
						file_paths: [filePath],
						trust_tier: 2,
						confidence: 0.95,
						extraction_method: "tree-sitter",
					});
				}
			}
		}

		// Run imports.scm query — pair @imported_name and @source captures
		const importsPath = join(queryDir, resolved.queryDir, "imports.scm");
		if (existsSync(importsPath)) {
			const matches = service.query(tree, importsPath);
			for (const match of matches) {
				const nameCapture = match.captures.find((c) => c.name === "imported_name");
				const sourceCapture = match.captures.find((c) => c.name === "source");

				if (nameCapture) {
					const dedupeKey = `import:${nameCapture.text}`;
					if (seen.has(dedupeKey)) continue;
					seen.add(dedupeKey);
					facts.push({
						type: "CodeEntity",
						name: nameCapture.text,
						content: surroundingLines(content, nameCapture.startIndex),
						summary: `import ${nameCapture.text} in ${base}`,
						tags: [langName, "import"],
						file_paths: [filePath],
						trust_tier: 2,
						confidence: 0.95,
						extraction_method: "tree-sitter",
						proposed_relationships: sourceCapture
							? [
									{
										target_name: sourceCapture.text.replace(/['"]/g, ""),
										type: "imports",
										weight: 0.9,
									},
								]
							: [],
					});
				} else if (sourceCapture) {
					// require() calls only have @source
					const dedupeKey = `import:${sourceCapture.text}`;
					if (seen.has(dedupeKey)) continue;
					seen.add(dedupeKey);
					facts.push({
						type: "CodeEntity",
						name: sourceCapture.text.replace(/['"]/g, ""),
						content: surroundingLines(content, sourceCapture.startIndex),
						summary: `import ${sourceCapture.text} in ${base}`,
						tags: [langName, "import"],
						file_paths: [filePath],
						trust_tier: 2,
						confidence: 0.95,
						extraction_method: "tree-sitter",
					});
				}
			}
		}

		// Run calls.scm query
		const callsPath = join(queryDir, resolved.queryDir, "calls.scm");
		if (existsSync(callsPath)) {
			const matches = service.query(tree, callsPath);
			for (const match of matches) {
				for (const cap of match.captures) {
					const dedupeKey = `call:${cap.text}`;
					if (seen.has(dedupeKey)) continue;
					seen.add(dedupeKey);
					facts.push({
						type: "CodeEntity",
						name: cap.text,
						content: surroundingLines(content, cap.startIndex),
						summary: `call ${cap.text} in ${base}`,
						tags: [langName, "call"],
						file_paths: [filePath],
						trust_tier: 2,
						confidence: 0.95,
						extraction_method: "tree-sitter",
					});
				}
			}
		}

		// If tree-sitter parsed but no query files found, return null to fall back
		if (facts.length === 0) return null;

		return facts;
	} catch {
		return null;
	}
}

/**
 * Dispatch extraction to the appropriate extractor based on the language tier
 * and optional special-handling hint.
 *
 * - Tier A: full structural extraction via extractTierA (15 languages)
 * - Tier B: structural extraction (no calls) via extractTierB (10 languages)
 * - Tier C sql-schema: SQL CREATE TABLE / INDEX extraction
 * - Tier C prisma-schema: Prisma model extraction
 * - Tier D project-manifest: manifest dependency extraction
 * - Default: empty array (unsupported tier/handling combination)
 */
export function dispatchExtraction(
	content: string,
	filePath: string,
	tier: ExtractionTier,
	specialHandling?: SpecialHandling,
): CandidateFact[] {
	switch (tier) {
		case "A":
			return extractTierA(content, filePath);
		case "B":
			return extractTierB(content, filePath);

		case "C":
			if (specialHandling === "sql-schema") {
				return extractSqlSchema(content, filePath);
			}
			if (specialHandling === "prisma-schema") {
				return extractPrismaSchema(content, filePath);
			}
			return [];

		case "D":
			if (specialHandling === "project-manifest") {
				return extractManifest(content, filePath);
			}
			return [];

		default:
			return [];
	}
}

/**
 * Async dispatch that attempts tree-sitter extraction first, falling back
 * to regex-based dispatch if tree-sitter is unavailable or fails.
 * Special-handling files (sql-schema, prisma-schema, project-manifest)
 * pass through directly to the sync dispatcher.
 */
export async function dispatchExtractionAsync(
	content: string,
	filePath: string,
	tier: ExtractionTier,
	langName: string,
	specialHandling?: SpecialHandling,
): Promise<CandidateFact[]> {
	if (specialHandling) {
		return dispatchExtraction(content, filePath, tier, specialHandling);
	}
	const tsFacts = await tryTreeSitterExtraction(content, filePath, langName);
	if (tsFacts) return tsFacts;
	const regexFacts = dispatchExtraction(content, filePath, tier, specialHandling);
	return regexFacts.map((f) => ({ ...f, extraction_method: "regex-fallback" }));
}
