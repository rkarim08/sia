// Module: context-mode — Large output chunking with intent-based retrieval

import { DEFAULT_CONFIG } from "@/shared/config";

export interface ContextModeResult {
	chunks: string[];
	totalIndexed: number;
	contextSaved: boolean;
}

/**
 * Apply context mode to a potentially large output string.
 *
 * If the output is below the threshold, return it as-is with contextSaved=false.
 * Otherwise, split into ~500-char chunks, score each by intent keyword matches,
 * and return the top 5 chunks sorted by score descending.
 */
export function applyContextMode(
	output: string,
	intent: string,
	threshold: number = DEFAULT_CONFIG.contextModeThreshold,
): ContextModeResult {
	if (output.length < threshold) {
		return { chunks: [output], totalIndexed: 0, contextSaved: false };
	}

	// Split output by newlines into chunks of ~500 chars each
	const lines = output.split("\n");
	const rawChunks: string[] = [];
	let current = "";

	for (const line of lines) {
		const candidate = current.length === 0 ? line : `${current}\n${line}`;
		if (candidate.length > 500 && current.length > 0) {
			rawChunks.push(current);
			current = line;
		} else {
			current = candidate;
		}
	}
	if (current.length > 0) {
		rawChunks.push(current);
	}

	const totalIndexed = rawChunks.length;

	// Score each chunk by counting intent keyword matches
	const intentWords = intent
		.trim()
		.split(/\s+/)
		.filter((w) => w.length > 0);

	const scored = rawChunks.map((chunk) => {
		let score = 0;
		if (intentWords.length > 0) {
			const lowerChunk = chunk.toLowerCase();
			for (const word of intentWords) {
				const lowerWord = word.toLowerCase();
				let pos = 0;
				while ((pos = lowerChunk.indexOf(lowerWord, pos)) !== -1) {
					score++;
					pos += lowerWord.length;
				}
			}
		}
		return { chunk, score };
	});

	// Sort by score descending, take top 5
	scored.sort((a, b) => b.score - a.score);
	const topChunks = scored.slice(0, 5).map((s) => s.chunk);

	return { chunks: topChunks, totalIndexed, contextSaved: true };
}
