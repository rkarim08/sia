// Module: post-compact — PostCompact hook handler
//
// Fires after Claude Code has compacted the context window. This is a
// lightweight handler — the compaction has already occurred, so there is
// nothing to capture at this point. Instead, it logs compaction coverage
// info for observability.
//
// Returns { status: "processed", compact_summary_length: N } where N is
// the character length of the compaction summary provided by Claude Code.

import type { HookEvent, HookResponse } from "@/hooks/types";

/**
 * Create a PostCompact hook handler.
 *
 * Lightweight — logs compaction coverage info and returns immediately.
 * No database writes are performed; knowledge should have been captured
 * by the PreCompact handler before compaction occurred.
 */
export function createPostCompactHandler(): (event: HookEvent) => Promise<HookResponse> {
	return async (event: HookEvent): Promise<HookResponse> => {
		const compactSummary = event.compact_summary ?? "";
		const summaryLength = compactSummary.length;

		return {
			status: "processed",
			compact_summary_length: summaryLength,
		};
	};
}
