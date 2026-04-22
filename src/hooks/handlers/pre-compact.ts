// Module: pre-compact — PreCompact hook handler
//
// Fires before Claude Code compacts the context window. Does three things:
//   1. Scans the transcript tail for any remaining unextracted knowledge
//      patterns and inserts them (legacy behaviour).
//   2. Calls `promoteStagedEntities()` — one last chance to upgrade
//      provisional Tier-4 staging rows before session context is lost.
//   3. Queries the top-5 active Preferences + top-3 active Episodes and
//      emits them as a `systemMessage` so the compactor preserves them
//      verbatim across summarisation.
//
// Failures in (2) or (3) are logged to stderr but never break the hook —
// compaction must always succeed, even if the staging queue is broken or the
// graph is read-only. See CHANGELOG.md [1.3.2] for background.

import { readFileSync } from "node:fs";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { promoteStagedEntities } from "@/graph/staging";
import { detectKnowledgePatterns } from "@/hooks/extractors/pattern-detector";
import type { HookEvent, HookResponse } from "@/hooks/types";

/** How many lines from the tail of the transcript to scan before compaction. */
const COMPACT_SEGMENT_SIZE = 100;

/** Max characters per preservation-list line; keeps the systemMessage compact. */
const PRESERVE_LINE_MAX_CHARS = 150;

/** Header prefix on the preservation systemMessage. */
const PRESERVE_HEADER = "Keep verbatim across compaction:";

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

/** Row shape returned by the preservation queries. */
interface PreserveRow {
	name: unknown;
	summary: unknown;
}

/** Truncate a single preservation line to fit {@link PRESERVE_LINE_MAX_CHARS}. */
function truncate(text: string, max: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Shape one preservation bullet: "- Name — summary" (≤ 150 chars). */
function formatPreserveLine(prefix: string, row: PreserveRow): string {
	const name = typeof row.name === "string" ? row.name.trim() : "";
	const summary = typeof row.summary === "string" ? row.summary.trim() : "";
	const body = summary ? `${name} — ${summary}` : name;
	return `- [${prefix}] ${truncate(body, PRESERVE_LINE_MAX_CHARS - prefix.length - 4)}`;
}

/**
 * Build the `systemMessage` body — top-5 Preferences + top-3 Episodes,
 * most-recent first, active-only. Returns `undefined` when the graph has
 * nothing to preserve so callers can omit the field entirely.
 */
async function buildPreservationMessage(db: SiaDb): Promise<string | undefined> {
	const prefsResult = await db.execute(
		`SELECT name, summary FROM graph_nodes
		 WHERE kind = 'Preference'
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL
		 ORDER BY t_valid_from DESC
		 LIMIT 5`,
	);

	const episodesResult = await db.execute(
		`SELECT name, summary FROM graph_nodes
		 WHERE kind = 'Episode'
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL
		 ORDER BY t_valid_from DESC
		 LIMIT 3`,
	);

	const prefs = prefsResult.rows as unknown as PreserveRow[];
	const episodes = episodesResult.rows as unknown as PreserveRow[];

	if (prefs.length === 0 && episodes.length === 0) return undefined;

	const lines: string[] = [PRESERVE_HEADER];
	for (const row of prefs) {
		lines.push(formatPreserveLine("Preference", row));
	}
	for (const row of episodes) {
		lines.push(formatPreserveLine("Episode", row));
	}
	return lines.join("\n");
}

/**
 * Create a PreCompact hook handler bound to the given graph database.
 *
 * Scans the transcript tail for uncaptured knowledge patterns, drains any
 * staged provisional entities, and emits a `systemMessage` listing the
 * top Preferences + Episodes that the compactor must preserve verbatim.
 */
export function createPreCompactHandler(db: SiaDb): (event: HookEvent) => Promise<HookResponse> {
	return async (event: HookEvent): Promise<HookResponse> => {
		// ------------------------------------------------------------------
		// Step 1 — transcript-tail pattern extraction (legacy behaviour).
		// ------------------------------------------------------------------
		const lines = readTranscriptLines(event.transcript_path);
		let snapshotNodes = 0;
		if (lines.length > 0) {
			const assistantContents = collectAssistantContent(lines);
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
		}

		// ------------------------------------------------------------------
		// Step 2 — drain staging queue. Failures must never break the hook.
		// ------------------------------------------------------------------
		let stagingPromoted = 0;
		let stagingKept = 0;
		let stagingRejected = 0;
		try {
			const staging = await promoteStagedEntities(db);
			stagingPromoted = staging.promoted;
			stagingKept = staging.kept;
			stagingRejected = staging.rejected;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`[sia:pre-compact] promoteStagedEntities failed: ${msg}\n`);
		}

		// ------------------------------------------------------------------
		// Step 3 — build preservation systemMessage. Failures logged, not thrown.
		// ------------------------------------------------------------------
		let systemMessage: string | undefined;
		try {
			systemMessage = await buildPreservationMessage(db);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`[sia:pre-compact] buildPreservationMessage failed: ${msg}\n`);
		}

		const response: HookResponse = {
			status: "processed",
			snapshot_nodes: snapshotNodes,
			staging_promoted: stagingPromoted,
			staging_kept: stagingKept,
			staging_rejected: stagingRejected,
		};
		if (systemMessage) {
			response.systemMessage = systemMessage;
		}
		return response;
	};
}
