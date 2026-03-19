// Module: pre-compact — PreCompact hook handler
//
// Fires before Claude Code compacts the context window. Reads the transcript
// for any remaining unextracted knowledge (using pattern detection), then
// creates a session snapshot in memory before the compaction discards detail.
//
// Returns { status: "processed", snapshot_nodes: N } where N is the count
// of patterns captured from the pre-compaction transcript scan.

import { readFileSync } from "node:fs";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { detectKnowledgePatterns } from "@/hooks/extractors/pattern-detector";
import type { HookEvent, HookResponse } from "@/hooks/types";

/** How many lines from the tail of the transcript to scan before compaction. */
const COMPACT_SEGMENT_SIZE = 100;

/** Shape of a single JSONL transcript line. */
interface TranscriptLine {
	role?: string;
	content?: string;
	tool_calls?: Array<{ name?: string; input?: Record<string, unknown> }>;
}

/**
 * Read and parse recent lines from a JSONL transcript file.
 */
function readTranscriptLines(path: string): TranscriptLine[] {
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return [];
	}

	const allLines = raw.split("\n").filter((l) => l.trim().length > 0);
	const recentLines = allLines.slice(-COMPACT_SEGMENT_SIZE);

	const parsed: TranscriptLine[] = [];
	for (const line of recentLines) {
		try {
			parsed.push(JSON.parse(line) as TranscriptLine);
		} catch {
			// Skip malformed lines
		}
	}

	return parsed;
}

/**
 * Collect assistant message content strings from transcript lines.
 */
function collectAssistantContent(lines: TranscriptLine[]): string[] {
	const contents: string[] = [];
	for (const line of lines) {
		if (line.role === "assistant" && typeof line.content === "string") {
			contents.push(line.content);
		}
	}
	return contents;
}

/**
 * Create a PreCompact hook handler bound to the given graph database.
 *
 * Scans the transcript tail for uncaptured knowledge patterns before
 * the context window is compacted, ensuring no knowledge is lost.
 */
export function createPreCompactHandler(db: SiaDb): (event: HookEvent) => Promise<HookResponse> {
	return async (event: HookEvent): Promise<HookResponse> => {
		const lines = readTranscriptLines(event.transcript_path);

		if (lines.length === 0) {
			return { status: "processed", snapshot_nodes: 0 };
		}

		const assistantContents = collectAssistantContent(lines);
		let snapshotNodes = 0;

		for (const content of assistantContents) {
			const patterns = detectKnowledgePatterns(content);
			for (const p of patterns) {
				await insertEntity(db, {
					type: p.type,
					name: `${p.type}: ${p.content.slice(0, 60)}`,
					content: p.content,
					summary: `${p.type} captured pre-compaction in session ${event.session_id}`,
					confidence: p.confidence,
					extraction_method: "hook:pre-compact:pattern",
					source_episode: event.session_id,
				});
				snapshotNodes++;
			}
		}

		return { status: "processed", snapshot_nodes: snapshotNodes };
	};
}
