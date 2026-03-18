// Module: tier-dispatch — Route file extraction by LanguageConfig.tier

import type { ExtractionTier, SpecialHandling } from "@/ast/languages";
import { extractTrackA } from "@/capture/track-a-ast";
import type { CandidateFact } from "@/capture/types";
import { extractPrismaSchema } from "./prisma-schema";
import { extractManifest } from "./project-manifest";
import { extractSqlSchema } from "./sql-schema";
import { extractTierA } from "./tier-a";

/**
 * Dispatch extraction to the appropriate extractor based on the language tier
 * and optional special-handling hint.
 *
 * - Tier A: full structural extraction via extractTierA (15 languages)
 * - Tier B: regex-based structural extraction via extractTrackA
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
			return extractTrackA(content, filePath);

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
