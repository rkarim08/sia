// Module: pattern-detector — Deterministic knowledge pattern detection (zero LLM)
//
// Scans text for structured knowledge markers: decisions, conventions, bugs,
// concepts, and solutions. Used by PostToolUse and Stop handlers to extract
// knowledge without requiring an LLM call.

import type { EntityType } from "@/capture/types";

/** A knowledge pattern detected in text content. */
export interface DetectedPattern {
	type: EntityType;
	content: string;
	confidence: number;
	/** The line that matched, for dedup downstream. */
	matchedLine: string;
}

// ---------------------------------------------------------------------------
// Content pattern rules — each rule maps a regex to an entity type
// ---------------------------------------------------------------------------

interface PatternRule {
	type: EntityType;
	pattern: RegExp;
	confidence: number;
}

const CONTENT_RULES: PatternRule[] = [
	// Decision markers
	{ type: "Decision", pattern: /\bwe decided\b/i, confidence: 0.85 },
	{ type: "Decision", pattern: /\bchose\s+\S+\s+over\b/i, confidence: 0.8 },
	{ type: "Decision", pattern: /\bdecision:\s*/i, confidence: 0.9 },

	// Convention markers
	{ type: "Convention", pattern: /\bconvention:\s*/i, confidence: 0.9 },
	{ type: "Convention", pattern: /\balways use\b/i, confidence: 0.7 },
	{ type: "Convention", pattern: /\bnever use\b/i, confidence: 0.7 },

	// Bug markers
	{ type: "Bug", pattern: /\bBUG:\s*/i, confidence: 0.9 },
	{ type: "Bug", pattern: /\bFIXME:\s*/i, confidence: 0.85 },
	{ type: "Bug", pattern: /\bHACK:\s*/i, confidence: 0.8 },

	// Concept markers
	{ type: "Concept", pattern: /\bTODO:\s*/i, confidence: 0.75 },
	{ type: "Concept", pattern: /\bREFACTOR:\s*/i, confidence: 0.75 },
];

// ---------------------------------------------------------------------------
// Commit message pattern rules
// ---------------------------------------------------------------------------

const COMMIT_RULES: PatternRule[] = [
	{ type: "Solution", pattern: /^fix(\(.+?\))?:\s*/i, confidence: 0.85 },
	{ type: "Decision", pattern: /^feat(\(.+?\))?:\s*/i, confidence: 0.75 },
	{ type: "Decision", pattern: /^refactor(\(.+?\))?:\s*/i, confidence: 0.7 },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan free-form content for knowledge patterns.
 * Processes line-by-line to attribute each match to the originating line.
 * Returns one DetectedPattern per match (a single line may yield multiple).
 */
export function detectKnowledgePatterns(content: string): DetectedPattern[] {
	const results: DetectedPattern[] = [];
	const lines = content.split("\n");

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;

		for (const rule of CONTENT_RULES) {
			if (rule.pattern.test(trimmed)) {
				results.push({
					type: rule.type,
					content: trimmed,
					confidence: rule.confidence,
					matchedLine: trimmed,
				});
			}
		}
	}

	return results;
}

/**
 * Scan a conventional commit message for knowledge patterns.
 * Recognizes fix/feat/refactor prefixes.
 */
export function detectCommitPatterns(message: string): DetectedPattern[] {
	const results: DetectedPattern[] = [];
	const trimmed = message.trim();

	for (const rule of COMMIT_RULES) {
		if (rule.pattern.test(trimmed)) {
			results.push({
				type: rule.type,
				content: trimmed,
				confidence: rule.confidence,
				matchedLine: trimmed,
			});
		}
	}

	return results;
}
