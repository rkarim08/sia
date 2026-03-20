// Module: throttle — Progressive rate limiting for MCP tool calls

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
}

const DEFAULT_THROTTLE_CONFIG: ThrottleConfig = {
	normalMax: 3,
	reducedMax: 8,
};

export const THROTTLED_TOOLS = new Set([
	"sia_search",
	"sia_execute",
	"sia_execute_file",
	"sia_fetch_and_index",
	"sia_by_file",
	"sia_expand",
	"sia_at_time",
	"sia_backlinks",
]);

/**
 * Progressive throttle backed by the search_throttle table in graph.db.
 *
 * Thresholds (inclusive):
 *  - count <= normalMax  → "normal"
 *  - count <= reducedMax → "reduced" (with warning)
 *  - count >  reducedMax → "blocked" (with warning mentioning sia_batch_execute)
 */
export class ProgressiveThrottle {
	private config: ThrottleConfig;

	constructor(
		private db: SiaDb,
		config?: Partial<ThrottleConfig>,
	) {
		this.config = { ...DEFAULT_THROTTLE_CONFIG, ...config };
	}

	/**
	 * Record a tool call for the given session/tool pair and return the throttle mode.
	 */
	async check(sessionId: string, toolName: string): Promise<ThrottleResult> {
		const now = Date.now();

		// Upsert: insert or increment call_count
		await this.db.execute(
			`INSERT INTO search_throttle (session_id, tool_name, call_count, last_called_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(session_id, tool_name) DO UPDATE SET
         call_count = call_count + 1,
         last_called_at = ?`,
			[sessionId, toolName, now, now],
		);

		// Read back the updated count
		const { rows } = await this.db.execute(
			"SELECT call_count FROM search_throttle WHERE session_id = ? AND tool_name = ?",
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
				warning: `Reducing results (${callCount} calls). Consider sia_batch_execute for batch operations.`,
			};
		}

		return {
			mode: "blocked",
			callCount,
			warning: `Tool blocked for this session (${callCount} calls). Use sia_batch_execute instead.`,
		};
	}

	/**
	 * Clear all throttle entries for the given session.
	 */
	async reset(sessionId: string): Promise<void> {
		await this.db.execute("DELETE FROM search_throttle WHERE session_id = ?", [sessionId]);
	}
}
