// Module: track-a-ast — structural extraction of code entities via regex patterns

import type { CandidateFact } from "@/capture/types";

/** Map of file extension to an array of regex patterns that capture entity names. */
const PATTERNS: Record<string, RegExp[]> = {
	".ts": [
		/export\s+(?:async\s+)?function\s+(\w+)/gm,
		/export\s+class\s+(\w+)/gm,
		/export\s+const\s+(\w+)/gm,
	],
	".tsx": [
		/export\s+(?:async\s+)?function\s+(\w+)/gm,
		/export\s+class\s+(\w+)/gm,
		/export\s+const\s+(\w+)/gm,
	],
	".js": [
		/export\s+(?:async\s+)?function\s+(\w+)/gm,
		/export\s+class\s+(\w+)/gm,
		/export\s+const\s+(\w+)/gm,
	],
	".jsx": [
		/export\s+(?:async\s+)?function\s+(\w+)/gm,
		/export\s+class\s+(\w+)/gm,
		/export\s+const\s+(\w+)/gm,
	],
	".py": [/^def\s+(\w+)/gm, /^class\s+(\w+)/gm],
	".go": [/^func\s+(\w+)/gm, /^type\s+(\w+)\s+struct/gm],
	".rs": [/^pub\s+fn\s+(\w+)/gm, /^pub\s+struct\s+(\w+)/gm],
};

/**
 * Given the surrounding lines around a match index, return a small context window.
 */
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

/**
 * Extract structural code entities from file content using regex-based pattern matching.
 *
 * @param content  The file text to scan.
 * @param filePath Optional path used to determine language by extension.
 * @returns An array of CandidateFact objects for every matched entity.
 */
export function extractTrackA(content: string, filePath?: string): CandidateFact[] {
	if (!filePath) return [];

	const dotIdx = filePath.lastIndexOf(".");
	if (dotIdx === -1) return [];

	const ext = filePath.slice(dotIdx);
	const patterns = PATTERNS[ext];
	if (!patterns) return [];

	const facts: CandidateFact[] = [];

	for (const pattern of patterns) {
		// Reset lastIndex so the regex starts from the beginning each time
		pattern.lastIndex = 0;

		let match: RegExpExecArray | null = pattern.exec(content);
		while (match !== null) {
			const name = match[1];
			const context = surroundingLines(content, match.index);
			facts.push({
				type: "CodeEntity",
				name,
				content: context,
				summary: `CodeEntity: ${name}`,
				tags: [],
				file_paths: [filePath],
				trust_tier: 2,
				confidence: 0.92,
				extraction_method: "regex-ast",
			});
			match = pattern.exec(content);
		}
	}

	return facts;
}
