// Module: sia-flag — Flag the current session for human review
//
// Writes a row to session_flags for pipeline consumption, and mirrors the flag
// as a SessionFlag node in graph_nodes so it participates in vector/FTS search.

import { v4 as uuid } from "uuid";
import type { z } from "zod";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import { buildNextSteps, type NextStep } from "@/mcp/next-steps";
import type { SiaFlagInput as SiaFlagInputSchema } from "@/mcp/server";

export type SiaFlagInput = z.infer<typeof SiaFlagInputSchema>;

export interface SiaFlagConfig {
	enableFlagging: boolean;
	sessionId: string;
}

export interface SiaFlagResult {
	flagged?: boolean;
	id?: string;
	error?: string;
	next_steps?: NextStep[];
}

/**
 * Sanitize a flag reason string.
 *
 * Strips: < > { } [ ] \ " and control characters (0x00-0x1F, 0x7F).
 * Keeps: `: backticks _ / # @ ( ) . , ' -` and all normal printable chars.
 * Truncates to 100 characters after sanitization.
 */
export function sanitizeReason(raw: string): string {
	// Remove < > { } [ ] \ " and control chars (0x00-0x1F, 0x7F)
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control characters for sanitization
	const cleaned = raw.replace(/[<>{}[\]\\"]/g, "").replace(/[\x00-\x1f\x7f]/g, "");
	return cleaned.slice(0, 100);
}

/**
 * Handle a sia_flag request:
 *   1. Insert a row into session_flags for pipeline consumption.
 *   2. Insert a corresponding SessionFlag node into graph_nodes so the flag
 *      is discoverable via FTS and vector search.
 *   3. If an embedder is provided, embed the flag node and persist the vector.
 *
 * The graph_nodes mirror is best-effort: failures to insert or embed the
 * mirror node are logged but do not cause the flag itself to fail — the
 * session_flags row is the authoritative record consumed by downstream
 * pipelines (capture/flag-processor).
 */
export async function handleSiaFlag(
	db: SiaDb,
	input: SiaFlagInput,
	config: SiaFlagConfig,
	embedder: Embedder | null = null,
): Promise<SiaFlagResult> {
	if (!config.enableFlagging) {
		return {
			error: "Flagging is disabled. Run 'npx sia enable-flagging' to enable.",
		};
	}

	const reason = sanitizeReason(input.reason);

	if (reason.length === 0) {
		return { error: "Flag reason is empty after sanitization" };
	}

	const id = uuid();
	const createdAt = Date.now();
	const createdAtStr = String(createdAt);

	await db.execute(
		`INSERT INTO session_flags (id, session_id, reason, created_at, consumed)
		 VALUES (?, ?, ?, ?, 0)`,
		[id, config.sessionId, reason, createdAt],
	);

	// --- Mirror the flag as a SessionFlag graph_nodes entity --------------
	// This lets flags surface in search results alongside other graph entities.
	// Failures here are best-effort and do not affect the authoritative
	// session_flags row written above.
	const flagEntity = {
		id,
		name: `Flag: ${reason.slice(0, 60)}`,
		content: reason,
	};

	try {
		await db.execute(
			`INSERT INTO graph_nodes (
				id, type, kind, name, summary, content,
				trust_tier, confidence, base_confidence,
				importance, base_importance,
				access_count, edge_count,
				tags, file_paths,
				t_created, t_valid_from,
				created_by, session_id,
				created_at, last_accessed
			) VALUES (
				?, 'SessionFlag', 'SessionFlag', ?, ?, ?,
				1, 1.0, 1.0,
				0.5, 0.5,
				0, 0,
				'[]', '[]',
				?, ?,
				'sia-flag', ?,
				?, ?
			)`,
			[
				flagEntity.id,
				flagEntity.name,
				reason,
				flagEntity.content,
				createdAtStr,
				createdAtStr,
				config.sessionId,
				createdAtStr,
				createdAtStr,
			],
		);
	} catch (err) {
		console.error(`[sia] sia_flag: failed to mirror flag ${flagEntity.id} into graph_nodes:`, err);
	}

	// --- Embed the flag entity so it participates in vector search --------
	if (embedder && flagEntity.id) {
		const textToEmbed = `${flagEntity.name ?? ""} ${flagEntity.content ?? ""}`.slice(0, 512);
		try {
			const embedding = await embedder.embed(textToEmbed);
			if (embedding) {
				await db.execute("UPDATE graph_nodes SET embedding = ? WHERE id = ?", [
					Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength),
					flagEntity.id,
				]);
			}
		} catch (err) {
			console.error(`[sia] sia_flag: failed to embed entity ${flagEntity.id}:`, err);
		}
	}

	const nextSteps = buildNextSteps("sia_flag", { hasFailure: false });
	return nextSteps.length > 0
		? { flagged: true, id, next_steps: nextSteps }
		: { flagged: true, id };
}
