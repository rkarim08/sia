// Module: throttle — Progressive throttling for MCP tool calls

import type { SiaDb } from "@/graph/db-interface";

export type ThrottleMode = "normal" | "reduced" | "blocked";

export interface ThrottleResult {
	mode: ThrottleMode;
	callCount: number;
	warning?: string;
}

export interface ThrottleConfig {
	normalMax: number;
	reducedMax: number;
	blockedMax: number;
}

/**
 * Progressive throttle backed by the search_throttle table in graph.db.
 *
 * Thresholds (inclusive):
 *  - count <= normalMax  → "normal"
 *  - count <= reducedMax → "reduced" (with warning)
 *  - count >  reducedMax → "blocked" (with warning)
 */
export class ProgressiveThrottle {
	constructor(
		private db: SiaDb,
		private config: ThrottleConfig,
	) {}

	/**
	 * Record a tool call for the given session/tool pair and return the throttle mode.
	 */
	async check(sessionId: string, toolName: string): Promise<ThrottleResult> {
		const now = Date.now();

		// Upsert: insert or increment call_count
		await this.db.execute(
			`INSERT INTO search_throttle (session_id, tool_name, call_count, last_called_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT (session_id, tool_name)
       DO UPDATE SET
         call_count = call_count + 1,
         last_called_at = ?`,
			[sessionId, toolName, now, now],
		);

		// Read back the updated count
		const { rows } = await this.db.execute(
			`SELECT call_count FROM search_throttle WHERE session_id = ? AND tool_name = ?`,
			[sessionId, toolName],
		);

		const callCount = (rows[0]?.call_count as number) ?? 1;
		const { normalMax, reducedMax } = this.config;

		if (callCount <= normalMax) {
			return { mode: "normal", callCount };
		}

		if (callCount <= reducedMax) {
			return {
				mode: "reduced",
				callCount,
				warning: `Tool '${toolName}' has been called ${callCount} times this session. Consider reducing search frequency.`,
			};
		}

		return {
			mode: "blocked",
			callCount,
			warning: `Tool '${toolName}' has been called ${callCount} times this session and is now blocked. Reset the session to continue.`,
		};
	}

	/**
	 * Clear all throttle entries for the given session.
	 */
	async reset(sessionId: string): Promise<void> {
		await this.db.execute(`DELETE FROM search_throttle WHERE session_id = ?`, [sessionId]);
	}
}
