// Module: next-steps — Shared helper that builds structured "what to call next"
// hints for MCP tool responses.
//
// Each MCP tool's handler returns a response object that MAY include an
// optional `next_steps` array. The array chains the current tool to the next
// natural tool call the agent should consider, closing the Phase 5 §5.7
// "trigger weakness" gap where stand-alone tools feel like dead ends.
//
// Hints are intentionally terse — a `tool` name, a one-sentence `why`, and
// (optionally) `args` the caller can spread straight into the next call.
// Consumers are free to ignore them: `next_steps` is additive and optional
// everywhere it appears.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single structured suggestion for the next MCP tool call.
 *
 * Intentionally small — just the name of the tool, a one-line rationale,
 * and optional argument hints the agent can forward.
 */
export interface NextStep {
	/** The fully-qualified MCP tool name, e.g. `sia_search` or `sia_backlinks`. */
	tool: string;
	/** One-line reason. Agent-facing; keep under ~80 chars. */
	why: string;
	/** Optional args payload; may be spread directly into the suggested call. */
	args?: Record<string, unknown>;
}

/**
 * Loose context the helper uses to decide which hints apply.
 *
 * All fields optional — different tools populate different subsets.
 * Only the fields the helper references are listed; everything else is
 * forwarded opaquely so call sites can pass extra telemetry without
 * tripping the type-checker.
 */
export interface NextStepsContext {
	/** Result count (entities, communities, checks, etc.). */
	resultCount?: number;
	/** ID of the top / primary entity returned, when applicable. */
	topEntityId?: string;
	/** File path associated with the top result, when applicable. */
	topFilePath?: string;
	/** Kind of entity created / considered (`sia_note`). */
	kind?: string;
	/** Whether the response reports a failure (`sia_doctor`, `sia_upgrade`). */
	hasFailure?: boolean;
	/** Depth explored (used by `sia_expand` to suggest impact analysis). */
	depthExplored?: number;
	/** Tier 3 (LLM-inferred) count on the graph — used by `sia_stats`. */
	tier3Count?: number;
	/** Whether the graph is empty — used by `sia_stats`. */
	emptyGraph?: boolean;
	/** Branch name of the newest snapshot (`sia_snapshot_list`). */
	newestBranchName?: string;
	/** Files changed (`sia_detect_changes`) — used to propose impact calls. */
	changedFiles?: string[];
	/** Conflict flag — used by `sia_note` Decision flow. */
	[extra: string]: unknown;
}

// ---------------------------------------------------------------------------
// buildNextSteps
// ---------------------------------------------------------------------------

/**
 * Build the `next_steps` array for the given tool + context.
 *
 * Returns `[]` when there is no natural chain to suggest (callers may then
 * omit the `next_steps` field entirely). Always returns a fresh array — safe
 * to mutate.
 */
export function buildNextSteps(toolName: string, context: NextStepsContext = {}): NextStep[] {
	switch (toolName) {
		case "sia_by_file":
			return siaByFileHints(context);
		case "sia_expand":
			return siaExpandHints(context);
		case "sia_community":
			return siaCommunityHints(context);
		case "sia_backlinks":
			return siaBacklinksHints(context);
		case "sia_note":
			return siaNoteHints(context);
		case "sia_stats":
			return siaStatsHints(context);
		case "sia_doctor":
			return siaDoctorHints(context);
		case "sia_upgrade":
			return siaUpgradeHints(context);
		case "sia_sync_status":
			return siaSyncStatusHints(context);
		case "sia_detect_changes":
			return siaDetectChangesHints(context);
		case "sia_index":
			return siaIndexHints(context);
		case "sia_batch_execute":
			return siaBatchExecuteHints(context);
		case "sia_fetch_and_index":
			return siaFetchAndIndexHints(context);
		case "sia_flag":
			return siaFlagHints(context);
		case "sia_models":
			return siaModelsHints(context);
		case "sia_snapshot_list":
			return siaSnapshotListHints(context);
		case "sia_snapshot_restore":
			return siaSnapshotRestoreHints(context);
		case "sia_snapshot_prune":
			return siaSnapshotPruneHints(context);
		default:
			return [];
	}
}

// ---------------------------------------------------------------------------
// Per-tool hint builders
// ---------------------------------------------------------------------------

function siaByFileHints(ctx: NextStepsContext): NextStep[] {
	const hints: NextStep[] = [];
	if ((ctx.resultCount ?? 0) > 0) {
		hints.push({
			tool: "sia_search",
			why: "Find related decisions, conventions, or bugs tied to this file",
		});
		if (ctx.topEntityId) {
			hints.push({
				tool: "sia_backlinks",
				why: "See which entities depend on the top hit",
				args: { entity_id: ctx.topEntityId },
			});
		}
	} else {
		hints.push({
			tool: "sia_search",
			why: "No file hits — broaden via semantic search on the topic",
		});
	}
	return hints;
}

function siaExpandHints(ctx: NextStepsContext): NextStep[] {
	const hints: NextStep[] = [];
	if (ctx.topFilePath) {
		hints.push({
			tool: "sia_by_file",
			why: "Inspect all entities in the top neighbour's file",
			args: { file_path: ctx.topFilePath },
		});
	}
	if ((ctx.depthExplored ?? 0) >= 3 && ctx.topEntityId) {
		hints.push({
			tool: "sia_impact",
			why: "Three+ layers reached — run blast-radius analysis",
			args: { entity_id: ctx.topEntityId },
		});
	}
	if (hints.length === 0) {
		hints.push({
			tool: "sia_impact",
			why: "Assess blast radius of the expanded entity",
			...(ctx.topEntityId ? { args: { entity_id: ctx.topEntityId } } : {}),
		});
	}
	return hints;
}

function siaCommunityHints(ctx: NextStepsContext): NextStep[] {
	const hints: NextStep[] = [];
	if ((ctx.resultCount ?? 0) > 0 && ctx.topEntityId) {
		hints.push({
			tool: "sia_backlinks",
			why: "Find dependents of the community-root entity",
			args: { node_id: ctx.topEntityId },
		});
	}
	hints.push({
		tool: "sia_search",
		why: "Drill into specific entities inside this community",
	});
	return hints;
}

function siaBacklinksHints(ctx: NextStepsContext): NextStep[] {
	const hints: NextStep[] = [];
	if ((ctx.resultCount ?? 0) > 0 && ctx.topEntityId) {
		hints.push({
			tool: "sia_expand",
			why: "Walk one hop out from a prominent caller",
			args: { entity_id: ctx.topEntityId },
		});
	}
	hints.push({
		tool: "sia_impact",
		why: "Quantify blast radius if this node were changed",
	});
	return hints;
}

function siaNoteHints(ctx: NextStepsContext): NextStep[] {
	const hints: NextStep[] = [
		{
			tool: "sia_search",
			why: "Confirm no near-duplicate note already captured this",
		},
	];
	if (ctx.kind === "Decision") {
		hints.push({
			tool: "sia_flag",
			why: "Flag for conflict review if this decision supersedes prior context",
		});
	}
	return hints;
}

function siaStatsHints(ctx: NextStepsContext): NextStep[] {
	const hints: NextStep[] = [];
	if (ctx.emptyGraph) {
		hints.push({
			tool: "/sia-learn",
			why: "Graph is empty — bootstrap it from the current repo",
		});
		return hints;
	}
	if ((ctx.tier3Count ?? 0) > 5) {
		hints.push({
			tool: "/sia-capture",
			why: "Many low-trust (Tier 3) entries — promote the worthwhile ones",
		});
	}
	hints.push({
		tool: "sia_doctor",
		why: "Verify graph integrity now that you've seen the counts",
	});
	return hints;
}

function siaDoctorHints(ctx: NextStepsContext): NextStep[] {
	if (ctx.hasFailure) {
		return [
			{
				tool: "sia_upgrade",
				why: "One or more checks failed — try upgrading first",
				args: { dry_run: true },
			},
			{
				tool: "/sia-setup",
				why: "Alternative: re-run setup to repair runtimes/hooks/models",
			},
		];
	}
	return [
		{
			tool: "sia_stats",
			why: "Healthy — inspect graph counts as a sanity check",
		},
	];
}

function siaUpgradeHints(ctx: NextStepsContext): NextStep[] {
	if (ctx.hasFailure) {
		return [
			{
				tool: "sia_doctor",
				why: "Upgrade failed — run diagnostics to pinpoint the issue",
			},
		];
	}
	return [
		{
			tool: "sia_doctor",
			why: "Post-upgrade: verify runtimes/FTS/graph are healthy",
		},
	];
}

function siaSyncStatusHints(ctx: NextStepsContext): NextStep[] {
	if (ctx.hasFailure) {
		return [
			{
				tool: "sia_doctor",
				why: "Sync errored — run diagnostics to narrow the cause",
			},
		];
	}
	return [];
}

function siaDetectChangesHints(ctx: NextStepsContext): NextStep[] {
	const files = ctx.changedFiles ?? [];
	if (files.length === 0) return [];
	return [
		{
			tool: "sia_impact",
			why: "Assess blast radius over the changed files",
		},
		{
			tool: "sia_by_file",
			why: "Inspect entities tied to the first changed file",
			args: { file_path: files[0] },
		},
	];
}

function siaIndexHints(ctx: NextStepsContext): NextStep[] {
	if ((ctx.resultCount ?? 0) === 0) return [];
	return [
		{
			tool: "sia_search",
			why: "Confirm the newly indexed chunks are retrievable",
		},
	];
}

function siaBatchExecuteHints(ctx: NextStepsContext): NextStep[] {
	if (ctx.hasFailure) {
		return [
			{
				tool: "sia_doctor",
				why: "One or more operations errored — run diagnostics",
			},
		];
	}
	return [];
}

function siaFetchAndIndexHints(ctx: NextStepsContext): NextStep[] {
	if (ctx.hasFailure) return [];
	return [
		{
			tool: "sia_search",
			why: "Verify the fetched content is now searchable",
		},
	];
}

function siaFlagHints(ctx: NextStepsContext): NextStep[] {
	if (ctx.hasFailure) return [];
	return [
		{
			tool: "sia_search",
			why: "Re-run the query that triggered the flag with fresh context",
		},
	];
}

function siaModelsHints(_ctx: NextStepsContext): NextStep[] {
	return [
		{
			tool: "sia_doctor",
			why: "Cross-check runtimes and ONNX model health",
		},
	];
}

function siaSnapshotListHints(ctx: NextStepsContext): NextStep[] {
	if ((ctx.resultCount ?? 0) === 0) return [];
	if (ctx.newestBranchName) {
		return [
			{
				tool: "sia_snapshot_restore",
				why: "Restore the newest snapshot",
				args: { branch_name: ctx.newestBranchName },
			},
		];
	}
	return [];
}

function siaSnapshotRestoreHints(_ctx: NextStepsContext): NextStep[] {
	return [
		{
			tool: "sia_doctor",
			why: "Verify graph integrity after restore",
		},
	];
}

function siaSnapshotPruneHints(_ctx: NextStepsContext): NextStep[] {
	return [
		{
			tool: "sia_snapshot_list",
			why: "Confirm the remaining snapshots post-prune",
		},
	];
}
