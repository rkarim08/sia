// src/retrieval/context-assembly.ts

import type { SiaSearchResult } from "@/graph/types";

export interface AssemblyOptions {
	includeProvenance?: boolean;
}

/**
 * Map a raw entity DB row to a typed SiaSearchResult.
 * - Parses JSON `tags` and `file_paths` (falls back to [] on parse failure)
 * - Includes `extraction_method` only when opts.includeProvenance is true
 * - Always includes `conflict_group_id` and `t_valid_from`
 */
export function assembleSearchResult(
	row: Record<string, unknown>,
	opts?: AssemblyOptions,
): SiaSearchResult {
	const result: SiaSearchResult = {
		entity_id: row.id as string,
		type: row.type as string,
		name: row.name as string,
		summary: row.summary as string,
		content: row.content as string,
		tags: safeParseJsonArray(row.tags as string),
		file_paths: safeParseJsonArray(row.file_paths as string),
		trust_tier: row.trust_tier as SiaSearchResult["trust_tier"],
		confidence: row.confidence as number,
		importance: row.importance as number,
		conflict_group_id: (row.conflict_group_id as string) ?? null,
		t_valid_from: (row.t_valid_from as number) ?? null,
		t_valid_until: (row.t_valid_until as number) ?? null,
	};

	if (opts?.includeProvenance && row.extraction_method) {
		result.extraction_method = row.extraction_method as string;
	}

	return result;
}

/**
 * Enforce maxResponseTokens by estimating ~150 tokens per result.
 * Returns whole results or nothing (no partial results).
 */
export function enforceResponseBudget(
	results: SiaSearchResult[],
	maxTokens: number,
): { results: SiaSearchResult[]; truncated: boolean } {
	const TOKENS_PER_RESULT = 150;

	if (maxTokens <= 0) {
		return { results: [], truncated: results.length > 0 };
	}

	const maxResults = Math.floor(maxTokens / TOKENS_PER_RESULT);

	if (results.length <= maxResults) {
		return { results, truncated: false };
	}

	return {
		results: results.slice(0, maxResults),
		truncated: true,
	};
}

function safeParseJsonArray(value: string): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
