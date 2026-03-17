// Module: sql-schema — Regex-based SQL CREATE TABLE/INDEX extraction

import type { CandidateFact } from "@/capture/types";

/**
 * Extract schema entities from SQL files using regex patterns.
 * Recognises CREATE TABLE and CREATE INDEX statements.
 */
export function extractSqlSchema(content: string, filePath: string): CandidateFact[] {
	const facts: CandidateFact[] = [];

	// CREATE TABLE
	const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
	let match: RegExpExecArray | null = tableRe.exec(content);
	while (match !== null) {
		const name = match[1];
		facts.push({
			type: "CodeEntity",
			name,
			content: surroundingContext(content, match.index),
			summary: `SQL table: ${name}`,
			tags: ["table"],
			file_paths: [filePath],
			trust_tier: 2,
			confidence: 0.9,
			extraction_method: "sql-schema",
		});
		match = tableRe.exec(content);
	}

	// CREATE INDEX
	const indexRe = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
	let idxMatch: RegExpExecArray | null = indexRe.exec(content);
	while (idxMatch !== null) {
		const name = idxMatch[1];
		facts.push({
			type: "CodeEntity",
			name,
			content: surroundingContext(content, idxMatch.index),
			summary: `SQL index: ${name}`,
			tags: ["index"],
			file_paths: [filePath],
			trust_tier: 2,
			confidence: 0.9,
			extraction_method: "sql-schema",
		});
		idxMatch = indexRe.exec(content);
	}

	return facts;
}

/** Return a few lines surrounding the match position for context. */
function surroundingContext(content: string, matchIndex: number): string {
	const before = content.lastIndexOf("\n", matchIndex);
	const lineStart = before === -1 ? 0 : before + 1;
	let end = matchIndex;
	for (let i = 0; i < 5; i++) {
		const next = content.indexOf("\n", end + 1);
		if (next === -1) {
			end = content.length;
			break;
		}
		end = next;
	}
	return content.slice(lineStart, end).trim();
}
