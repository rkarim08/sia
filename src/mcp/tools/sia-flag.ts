// Module: sia-flag — Flag the current session for human review

import { v4 as uuid } from "uuid";
import type { z } from "zod";
import type { SiaDb } from "@/graph/db-interface";
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
 * Handle a sia_flag request: insert a flag into session_flags for human review.
 */
export async function handleSiaFlag(
	db: SiaDb,
	input: SiaFlagInput,
	config: SiaFlagConfig,
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

	await db.execute(
		`INSERT INTO session_flags (id, session_id, reason, created_at, consumed)
		 VALUES (?, ?, ?, ?, 0)`,
		[id, config.sessionId, reason, createdAt],
	);

	return { flagged: true, id };
}
