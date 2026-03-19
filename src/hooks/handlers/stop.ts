// Module: stop — Stop hook handler
//
// Fires when Claude Code is about to exit. Reads the recent segment of
// the transcript (JSONL), checks whether sia_note was already called,
// and scans assistant messages for uncaptured knowledge patterns.

import { readFileSync } from "node:fs";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { detectKnowledgePatterns } from "@/hooks/extractors/pattern-detector";
import type { HookEvent, HookHandler, HookResponse } from "@/hooks/types";

/** How many lines from the tail of the transcript to scan. */
const RECENT_SEGMENT_SIZE = 50;

/** Shape of a single JSONL transcript line. */
interface TranscriptLine {
	role?: string;
	content?: string;
	tool_calls?: Array<{ name?: string; input?: Record<string, unknown> }>;
}

/**
 * Read and parse the recent segment of a JSONL transcript file.
 * Returns the last RECENT_SEGMENT_SIZE parsed lines.
 */
function readRecentTranscript(path: string): TranscriptLine[] {
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return [];
	}

	const allLines = raw.split("\n").filter((l) => l.trim().length > 0);
	const recentLines = allLines.slice(-RECENT_SEGMENT_SIZE);

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
 * Check if sia_note was called in the recent transcript segment.
 */
function hasSiaNoteCall(lines: TranscriptLine[]): boolean {
	for (const line of lines) {
		if (!line.tool_calls) continue;
		for (const call of line.tool_calls) {
			if (call.name === "sia_note") return true;
		}
	}
	return false;
}

/**
 * Collect assistant message content from transcript lines.
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Stop hook handler bound to the given graph database.
 * Scans the transcript tail for uncaptured knowledge patterns.
 */
export function createStopHandler(db: SiaDb): HookHandler {
	return async (event: HookEvent): Promise<HookResponse> => {
		const lines = readRecentTranscript(event.transcript_path);

		// If transcript is empty or unreadable, nothing to do
		if (lines.length === 0) {
			return { status: "no_new_knowledge", nodes_created: 0 };
		}

		// If sia_note was already called, knowledge was captured inline
		if (hasSiaNoteCall(lines)) {
			return { status: "already_captured", nodes_created: 0 };
		}

		// Scan assistant messages for knowledge patterns
		const assistantContents = collectAssistantContent(lines);
		if (assistantContents.length === 0) {
			return { status: "no_new_knowledge", nodes_created: 0 };
		}

		let nodesCreated = 0;

		for (const content of assistantContents) {
			const patterns = detectKnowledgePatterns(content);
			for (const p of patterns) {
				await insertEntity(db, {
					type: p.type,
					name: `${p.type}: ${p.content.slice(0, 60)}`,
					content: p.content,
					summary: `${p.type} detected in session ${event.session_id}`,
					confidence: p.confidence,
					extraction_method: "hook:stop:pattern",
					source_episode: event.session_id,
				});
				nodesCreated++;
			}
		}

		if (nodesCreated === 0) {
			return { status: "no_new_knowledge", nodes_created: 0 };
		}

		return { status: "processed", nodes_created: nodesCreated };
	};
}
