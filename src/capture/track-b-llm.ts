// Module: track-b-llm — semantic extraction via pattern matching (Track B)

import type { CandidateFact, EntityType } from "@/capture/types";

interface TrackBConfig {
	captureModel: string;
	minExtractConfidence: number;
	airGapped: boolean;
}

interface PatternEntry {
	pattern: RegExp;
	type: EntityType;
}

const PATTERNS: PatternEntry[] = [
	{
		pattern: /decided to|chose|we will use|going with|selected|opted for/i,
		type: "Decision",
	},
	{
		pattern: /bug|error|crash|broken|failing|exception|regression/i,
		type: "Bug",
	},
	{
		pattern: /always|never|must|convention|rule:|standard:/i,
		type: "Convention",
	},
	{
		pattern: /fix|solved|workaround|resolution|patch/i,
		type: "Solution",
	},
];

function splitSentences(content: string): string[] {
	return content
		.split(/\. |\n/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export async function extractTrackB(
	content: string,
	config: TrackBConfig,
): Promise<CandidateFact[]> {
	if (config.airGapped) {
		return [];
	}

	const sentences = splitSentences(content);
	const candidates: CandidateFact[] = [];

	for (const sentence of sentences) {
		for (const { pattern, type } of PATTERNS) {
			if (pattern.test(sentence)) {
				candidates.push({
					type,
					name: sentence.slice(0, 50),
					content: sentence,
					summary: sentence.slice(0, 80),
					tags: [],
					file_paths: [],
					trust_tier: 3,
					confidence: 0.7,
					extraction_method: "pattern-match",
				});
				break;
			}
		}
	}

	return candidates.filter((c) => c.confidence >= config.minExtractConfidence);
}
