// Module: track-b-llm — semantic extraction via LLM or pattern matching (Track B)

import { extractPrompt } from "@/capture/prompts/extract";
import type { CandidateFact, EntityType, ProposedRelationship } from "@/capture/types";

interface LlmMessageParam {
	role: string;
	content: string;
}

interface LlmCreateParams {
	model: string;
	max_tokens: number;
	system: string;
	messages: LlmMessageParam[];
}

interface LlmResponse {
	content: Array<{ text: string }>;
}

interface LlmClient {
	messages: {
		create: (params: LlmCreateParams) => Promise<LlmResponse>;
	};
}

interface TrackBConfig {
	captureModel: string;
	minExtractConfidence: number;
	airGapped: boolean;
	llmClient?: LlmClient;
}

interface PatternEntry {
	pattern: RegExp;
	type: EntityType;
}

interface RawFact {
	type?: string;
	name?: string;
	content?: string;
	summary?: string;
	tags?: string[];
	file_paths?: string[];
	confidence?: number;
	proposed_relationships?: ProposedRelationship[];
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

function patternMatch(content: string, minConfidence: number): CandidateFact[] {
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

	return candidates.filter((c) => c.confidence >= minConfidence);
}

export async function extractTrackB(
	content: string,
	config: TrackBConfig,
): Promise<CandidateFact[]> {
	if (config.airGapped) {
		return [];
	}

	// LLM path: attempt extraction via Anthropic API when client is provided
	if (config.llmClient) {
		try {
			const { system, user } = extractPrompt(content);
			const response = await config.llmClient.messages.create({
				model: config.captureModel,
				max_tokens: 1024,
				system,
				messages: [{ role: "user", content: user }],
			});

			const rawText: string = response.content[0].text;
			const parsed: { facts?: RawFact[] } = JSON.parse(rawText) as { facts?: RawFact[] };
			const facts: RawFact[] = Array.isArray(parsed.facts) ? parsed.facts : [];

			const candidates: CandidateFact[] = facts.map((f: RawFact) => ({
				type: (f.type ?? "Concept") as EntityType,
				name: String(f.name ?? "").slice(0, 200),
				content: String(f.content ?? ""),
				summary: String(f.summary ?? ""),
				tags: Array.isArray(f.tags) ? f.tags : [],
				file_paths: Array.isArray(f.file_paths) ? f.file_paths : [],
				trust_tier: 3,
				confidence: typeof f.confidence === "number" ? f.confidence : 0.7,
				extraction_method: "llm-haiku",
				proposed_relationships: Array.isArray(f.proposed_relationships)
					? f.proposed_relationships
					: undefined,
			}));

			return candidates.filter((c) => c.confidence >= config.minExtractConfidence);
		} catch {
			// Fall through to pattern matching
		}
	}

	// Pattern matching fallback
	return patternMatch(content, config.minExtractConfidence);
}
