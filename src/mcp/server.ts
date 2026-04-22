// Module: server — MCP server registering all Sia tool handlers
//
// Read-heavy against graph.db. Write paths: session_flags (sia_flag),
// graph entities/edges (sia_note), sandbox results (sia_execute*).

import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Embedder } from "@/capture/embedder";
import type { FeedbackCollector } from "@/feedback/collector";
import type { SiaDb } from "@/graph/db-interface";
import { getNextStepHint } from "@/mcp/next-step-hints";
import { handleNousConcern } from "@/mcp/tools/nous-concern";
import { handleNousCuriosity } from "@/mcp/tools/nous-curiosity";
import { handleNousModify } from "@/mcp/tools/nous-modify";
import { handleNousReflect } from "@/mcp/tools/nous-reflect";
import { handleNousState } from "@/mcp/tools/nous-state";
import {
	handleSiaAstQuery,
	type SiaAstQueryInput as SiaAstQueryHandlerInput,
} from "@/mcp/tools/sia-ast-query";
import { handleSiaAtTime } from "@/mcp/tools/sia-at-time";
import { handleSiaBacklinks } from "@/mcp/tools/sia-backlinks";
import { handleSiaBatchExecute } from "@/mcp/tools/sia-batch-execute";
import { handleSiaByFile } from "@/mcp/tools/sia-by-file";
import { handleSiaCommunity } from "@/mcp/tools/sia-community";
import { handleSiaDetectChanges } from "@/mcp/tools/sia-detect-changes";
import { handleSiaDoctor } from "@/mcp/tools/sia-doctor";
import { handleSiaExecute } from "@/mcp/tools/sia-execute";
import { handleSiaExecuteFile } from "@/mcp/tools/sia-execute-file";
import { handleSiaExpand } from "@/mcp/tools/sia-expand";
import { handleSiaFetchAndIndex } from "@/mcp/tools/sia-fetch-and-index";
import { handleSiaFlag } from "@/mcp/tools/sia-flag";
import { handleSiaImpact } from "@/mcp/tools/sia-impact";
import { handleSiaIndex } from "@/mcp/tools/sia-index";
import { handleSiaModels, SiaModelsInput } from "@/mcp/tools/sia-models";
import { handleSiaNote } from "@/mcp/tools/sia-note";
import { handleSiaSearch } from "@/mcp/tools/sia-search";
import { handleSiaSnapshotList } from "@/mcp/tools/sia-snapshot-list";
import { handleSiaSnapshotPrune } from "@/mcp/tools/sia-snapshot-prune";
import { handleSiaSnapshotRestore } from "@/mcp/tools/sia-snapshot-restore";
import { handleSiaStats } from "@/mcp/tools/sia-stats";
import { handleSiaSyncStatus } from "@/mcp/tools/sia-sync-status";
import { handleSiaUpgrade } from "@/mcp/tools/sia-upgrade";
import { truncateResponse } from "@/mcp/truncate";
import type { ModelManager } from "@/models/manager";
import type { OnnxSession } from "@/models/types";
import type { PipelineDeps } from "@/retrieval/search";
import { ProgressiveThrottle } from "@/retrieval/throttle";
import type { SiaConfig } from "@/shared/config";

// ---------------------------------------------------------------------------
// Zod input schemas for every tool — exported so tests (and future handler
// modules) can reference them directly.
// ---------------------------------------------------------------------------

export const SiaSearchInput = z.object({
	query: z.string(),
	task_type: z.enum(["orientation", "feature", "bug-fix", "regression", "review"]).optional(),
	node_types: z.array(z.string()).optional(),
	package_path: z.string().optional(),
	workspace: z.boolean().optional(),
	paranoid: z.boolean().optional(),
	limit: z.number().optional(),
	include_provenance: z.boolean().optional(),
});

export const SiaByFileInput = z.object({
	file_path: z.string(),
	workspace: z.boolean().optional(),
	limit: z.number().optional(),
});

export const SiaExpandInput = z.object({
	entity_id: z.string(),
	depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
	edge_types: z.array(z.string()).optional(),
	include_cross_repo: z.boolean().optional(),
});

export const SiaCommunityInput = z.object({
	query: z.string().optional(),
	entity_id: z.string().optional(),
	level: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
	package_path: z.string().optional(),
});

export const SiaAtTimeInput = z.object({
	as_of: z.string(),
	entity_types: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	limit: z.number().optional(),
});

export const SiaFlagInput = z.object({
	reason: z.string(),
});

export const SiaBacklinksInput = z.object({
	node_id: z.string(),
	edge_types: z.array(z.string()).optional(),
});

export const SiaNoteInput = z.object({
	kind: z.enum(["Decision", "Convention", "Bug", "Solution", "Concept"]),
	name: z.string(),
	content: z.string(),
	tags: z.array(z.string()).optional(),
	relates_to: z.array(z.string()).optional(),
	supersedes: z.string().optional(),
});

export const SiaExecuteInput = z.object({
	code: z.string(),
	language: z.string().optional(),
	intent: z.string().optional(),
	timeout: z.number().optional(),
	env: z.record(z.string(), z.string()).optional(),
});

export const SiaExecuteFileInput = z.object({
	file_path: z.string(),
	language: z.string().optional(),
	command: z.string().optional(),
	intent: z.string().optional(),
	timeout: z.number().optional(),
});

export const SiaIndexInput = z.object({
	content: z.string(),
	source: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

export const SiaBatchExecuteInput = z.object({
	operations: z.array(
		z.object({
			type: z.enum(["execute", "search"]),
			code: z.string().optional(),
			language: z.string().optional(),
			query: z.string().optional(),
			intent: z.string().optional(),
		}),
	),
	timeout_per_op: z.number().optional(),
});

export const SiaFetchAndIndexInput = z.object({
	url: z.string().url(),
	intent: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

export const SiaStatsInput = z.object({
	include_session: z.boolean().optional(),
});

export const SiaDoctorInput = z.object({
	checks: z
		.array(z.enum(["runtimes", "hooks", "fts5", "vss", "onnx", "graph_integrity", "all"]))
		.optional(),
});

export const SiaSyncStatusInput = z.object({});

export const SiaUpgradeInput = z.object({
	target_version: z.string().optional(),
	dry_run: z.boolean().optional(),
});

export const SiaAstQueryInput = z.object({
	file_path: z.string(),
	query_type: z.enum(["symbols", "imports", "calls"]),
	max_results: z.number().optional(),
});

export const SiaDetectChangesInput = z.object({
	scope: z.string().optional(),
	compare: z.string().optional(),
});

export const SiaImpactInput = z.object({
	entity_id: z.string(),
	max_depth: z.number().optional(),
	edge_types: z.array(z.string()).optional(),
	min_confidence: z.number().optional(),
});

export const SiaSnapshotListInput = z.object({});

export const SiaSnapshotRestoreInput = z.object({
	branch_name: z.string(),
});

export const SiaSnapshotPruneInput = z.object({
	branch_names: z.array(z.string()),
});

// Nous cognitive layer inputs
export const NousStateInput = z.object({
	session_id: z.string().optional().describe("Session ID — omit to use current session"),
});

export const NousReflectInput = z.object({
	context: z.string().optional().describe("Optional context string to narrow Preference retrieval"),
	session_id: z.string().optional(),
});

export const NousCuriosityInput = z.object({
	topic: z.string().optional().describe("Optional topic to constrain exploration"),
	depth: z
		.union([z.literal(1), z.literal(2), z.literal(3)])
		.optional()
		.describe("Exploration depth (1–3, default 1)"),
	session_id: z.string().optional(),
});

export const NousConcernInput = z.object({
	context: z.string().optional().describe("Optional context filter"),
	person: z.string().optional().describe("Optional person filter"),
});

export const NousModifyInput = z.object({
	action: z.enum(["create", "update", "deprecate"]),
	preference: z.string().describe("Full preference statement"),
	reason: z.string().describe("Required: why this preference is being created/changed"),
	existing_node_id: z
		.string()
		.optional()
		.describe("ID of existing Preference node for update/deprecate"),
	session_id: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Tool names — single source of truth
// ---------------------------------------------------------------------------

export const TOOL_NAMES = [
	"sia_models",
	"sia_search",
	"sia_by_file",
	"sia_expand",
	"sia_community",
	"sia_at_time",
	"sia_flag",
	"sia_backlinks",
	"sia_note",
	"sia_execute",
	"sia_execute_file",
	"sia_index",
	"sia_batch_execute",
	"sia_fetch_and_index",
	"sia_stats",
	"sia_doctor",
	"sia_upgrade",
	"sia_sync_status",
	"sia_ast_query",
	"sia_impact",
	"sia_detect_changes",
	"sia_snapshot_list",
	"sia_snapshot_restore",
	"sia_snapshot_prune",
	"nous_state",
	"nous_reflect",
	"nous_curiosity",
	"nous_concern",
	"nous_modify",
] as const;

export type SiaToolName = (typeof TOOL_NAMES)[number];

// ---------------------------------------------------------------------------
// McpServerDeps — dependencies for wiring real tool handlers
// ---------------------------------------------------------------------------

export interface McpServerDeps {
	graphDb: SiaDb;
	bridgeDb: SiaDb | null;
	metaDb: SiaDb | null;
	embedder: Embedder | null;
	config: SiaConfig;
	sessionId: string;
	modelManager?: ModelManager | null;
	sessionPool?: import("@/models/session-pool").SessionPool | null;
	crossEncoder?: import("@/retrieval/cross-encoder").CrossEncoderReranker | null;
	attentionFusionSession?: OnnxSession | null;
	feedbackCollector?: FeedbackCollector | null;
}

// ---------------------------------------------------------------------------
// safeToolCall — wrap a handler call with try-catch, returning structured error
// ---------------------------------------------------------------------------

/** Wrap a handler call with try-catch, truncation, and server-side error logging. */
async function safeToolCall<T>(
	toolName: string,
	fn: () => Promise<T>,
	maxChars?: number,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
	try {
		const result = await fn();
		const hint = getNextStepHint(toolName);
		const resultText = JSON.stringify(truncateResponse(result, maxChars));
		const text = hint ? `${resultText}\n\n${hint}` : resultText;
		return {
			content: [{ type: "text" as const, text }],
		};
	} catch (err) {
		console.error(`[sia] ${toolName} error:`, err);
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({
						error: `${toolName} failed: ${err instanceof Error ? err.message : String(err)}`,
					}),
				},
			],
			isError: true,
		};
	}
}

// ---------------------------------------------------------------------------
// createMcpServer — builds and returns a configured McpServer
// ---------------------------------------------------------------------------

export function createMcpServer(deps?: McpServerDeps): McpServer {
	const server = new McpServer({ name: "sia", version: "0.1.0" });
	// workingMemoryTokenBudget is token-denominated; multiply by ~4 to approximate
	// a character budget for JSON truncation (1 token ≈ 4 chars in JSON output).
	const maxChars = deps ? deps.config.workingMemoryTokenBudget * 4 : undefined;

	// --- sia_models --------------------------------------------------------
	server.registerTool(
		"sia_models",
		{
			description:
				"Check transformer model tier status, installed models, and attention head training phase",
			inputSchema: SiaModelsInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			return safeToolCall(
				"sia_models",
				async () => handleSiaModels(args, deps?.modelManager ?? null),
				maxChars,
			);
		},
	);

	// --- sia_search --------------------------------------------------------
	server.registerTool(
		"sia_search",
		{
			description: "Semantic search across the Sia knowledge graph",
			inputSchema: SiaSearchInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				// Resolve attention fusion session from direct dep or session pool
				let attnSession = deps.attentionFusionSession ?? undefined;
				if (!attnSession && deps.sessionPool) {
					const poolSession = await deps.sessionPool.getSession("sia-attention-head");
					attnSession = poolSession ?? undefined;
				}

				const pipelineDeps: PipelineDeps = {
					crossEncoder: deps.crossEncoder ?? undefined,
					attentionFusionSession: attnSession,
				};
				return safeToolCall(
					"sia_search",
					() =>
						handleSiaSearch(
							deps.graphDb,
							args,
							deps.embedder ?? undefined,
							undefined,
							{ crossEncoderTimeoutMs: deps.config.crossEncoderTimeoutMs },
							pipelineDeps,
							{
								feedbackCollector: deps.feedbackCollector ?? null,
								sessionId: deps.sessionId,
							},
						),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_by_file -------------------------------------------------------
	server.registerTool(
		"sia_by_file",
		{
			description: "Retrieve knowledge graph nodes associated with a file",
			inputSchema: SiaByFileInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"sia_by_file",
					() =>
						handleSiaByFile(deps.graphDb, args, undefined, {
							feedbackCollector: deps.feedbackCollector ?? null,
							sessionId: deps.sessionId,
						}),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_expand --------------------------------------------------------
	server.registerTool(
		"sia_expand",
		{
			description: "Expand an entity's neighbourhood in the knowledge graph",
			inputSchema: SiaExpandInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"sia_expand",
					() =>
						handleSiaExpand(deps.graphDb, args, {
							feedbackCollector: deps.feedbackCollector ?? null,
							sessionId: deps.sessionId,
						}),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_community -----------------------------------------------------
	server.registerTool(
		"sia_community",
		{
			description: "Retrieve community-level summaries from the knowledge graph",
			inputSchema: SiaCommunityInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"sia_community",
					() => handleSiaCommunity(deps.graphDb, args),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_at_time -------------------------------------------------------
	server.registerTool(
		"sia_at_time",
		{
			description: "Query the knowledge graph at a point in time",
			inputSchema: SiaAtTimeInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_at_time", () => handleSiaAtTime(deps.graphDb, args), maxChars);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_flag ----------------------------------------------------------
	server.registerTool(
		"sia_flag",
		{
			description: "Flag current session for human review (writes to session_flags only)",
			inputSchema: SiaFlagInput.shape,
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"sia_flag",
					() =>
						handleSiaFlag(
							deps.graphDb,
							args,
							{
								enableFlagging: deps.config.enableFlagging,
								sessionId: deps.sessionId,
							},
							deps.embedder ?? null,
						),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_backlinks -----------------------------------------------------
	server.registerTool(
		"sia_backlinks",
		{
			description: "Find all incoming edges (backlinks) to a knowledge graph node",
			inputSchema: SiaBacklinksInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"sia_backlinks",
					() => handleSiaBacklinks(deps.graphDb, args),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_note ----------------------------------------------------------
	server.registerTool(
		"sia_note",
		{
			description: "Create a developer-authored knowledge entry in the graph",
			inputSchema: SiaNoteInput.shape,
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_note", () => handleSiaNote(deps.graphDb, args), maxChars);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_execute -------------------------------------------------------
	server.registerTool(
		"sia_execute",
		{
			description: "Execute code in an isolated sandbox",
			inputSchema: SiaExecuteInput.shape,
			annotations: { readOnlyHint: false },
		},
		async (args) => {
			if (deps) {
				const embedder = deps.embedder ?? null;
				const throttle = new ProgressiveThrottle(deps.graphDb, {
					normalMax: deps.config.throttleNormalMax,
					reducedMax: deps.config.throttleReducedMax,
				});
				return safeToolCall(
					"sia_execute",
					() =>
						handleSiaExecute(deps.graphDb, args, embedder, throttle, deps.sessionId, {
							sandboxTimeoutMs: deps.config.sandboxTimeoutMs,
							sandboxOutputMaxBytes: deps.config.sandboxOutputMaxBytes,
							contextModeThreshold: deps.config.contextModeThreshold,
							contextModeTopK: deps.config.contextModeTopK,
						}),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_execute_file --------------------------------------------------
	server.registerTool(
		"sia_execute_file",
		{
			description: "Execute an existing file in a sandbox subprocess",
			inputSchema: SiaExecuteFileInput.shape,
			annotations: { readOnlyHint: false },
		},
		async (args) => {
			if (deps) {
				const embedderFile = deps.embedder ?? null;
				const throttle = new ProgressiveThrottle(deps.graphDb, {
					normalMax: deps.config.throttleNormalMax,
					reducedMax: deps.config.throttleReducedMax,
				});
				return safeToolCall(
					"sia_execute_file",
					() =>
						handleSiaExecuteFile(deps.graphDb, args, embedderFile, throttle, deps.sessionId, {
							sandboxTimeoutMs: deps.config.sandboxTimeoutMs,
							sandboxOutputMaxBytes: deps.config.sandboxOutputMaxBytes,
							contextModeThreshold: deps.config.contextModeThreshold,
							contextModeTopK: deps.config.contextModeTopK,
						}),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_index ---------------------------------------------------------
	server.registerTool(
		"sia_index",
		{
			description: "Index markdown/text content by chunking and scanning for entity references",
			inputSchema: SiaIndexInput.shape,
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async (args) => {
			if (deps) {
				const embedderIndex = deps.embedder ?? null;
				return safeToolCall(
					"sia_index",
					() => handleSiaIndex(deps.graphDb, args, embedderIndex, deps.sessionId),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_batch_execute -------------------------------------------------
	server.registerTool(
		"sia_batch_execute",
		{
			description: "Execute multiple operations in one call with precedes edges",
			inputSchema: SiaBatchExecuteInput.shape,
			annotations: { readOnlyHint: false },
		},
		async (args) => {
			if (deps) {
				const embedderBatch = deps.embedder ?? null;
				const throttle = new ProgressiveThrottle(deps.graphDb, {
					normalMax: deps.config.throttleNormalMax,
					reducedMax: deps.config.throttleReducedMax,
				});
				return safeToolCall(
					"sia_batch_execute",
					() =>
						handleSiaBatchExecute(
							deps.graphDb,
							args as Parameters<typeof handleSiaBatchExecute>[1],
							embedderBatch,
							throttle,
							deps.sessionId,
							{ timeoutPerOp: deps.config.sandboxTimeoutMs },
						),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_fetch_and_index -----------------------------------------------
	server.registerTool(
		"sia_fetch_and_index",
		{
			description: "Fetch a URL, convert to markdown, and index via contentTypeChunker",
			inputSchema: SiaFetchAndIndexInput.shape,
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async (args) => {
			if (deps) {
				const embedderFetch = deps.embedder ?? null;
				return safeToolCall(
					"sia_fetch_and_index",
					() => handleSiaFetchAndIndex(deps.graphDb, args, embedderFetch, deps.sessionId),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_stats ---------------------------------------------------------
	server.registerTool(
		"sia_stats",
		{
			description: "Return graph metrics: node/edge counts by type, optional session stats",
			inputSchema: SiaStatsInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"sia_stats",
					() => handleSiaStats(deps.graphDb, args, deps.sessionId),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_doctor --------------------------------------------------------
	server.registerTool(
		"sia_doctor",
		{
			description: "Run diagnostic checks on the Sia installation",
			inputSchema: SiaDoctorInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_doctor", () => handleSiaDoctor(deps.graphDb, args), maxChars);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_upgrade -------------------------------------------------------
	server.registerTool(
		"sia_upgrade",
		{
			description: "Self-update Sia to the latest version",
			inputSchema: SiaUpgradeInput.shape,
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"sia_upgrade",
					() =>
						handleSiaUpgrade(deps.graphDb, args, {
							siaRoot: join(import.meta.dir, "../.."),
							upgradeReleaseUrl: deps.config.upgradeReleaseUrl ?? undefined,
						}),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_sync_status ---------------------------------------------------
	server.registerTool(
		"sia_sync_status",
		{
			description: "Check team sync configuration and connection status",
			inputSchema: SiaSyncStatusInput.shape,
			annotations: { readOnlyHint: true },
		},
		async () => {
			return safeToolCall("sia_sync_status", () => handleSiaSyncStatus(), maxChars);
		},
	);

	// --- sia_ast_query -----------------------------------------------------
	server.registerTool(
		"sia_ast_query",
		{
			description:
				"Parse a file with tree-sitter and extract symbols, imports, or call relationships",
			inputSchema: SiaAstQueryInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			// sia_ast_query is stateless — no deps needed. It returns errors in-band
			// via the error field rather than throwing, so we propagate isError manually.
			const result = await handleSiaAstQuery(args as SiaAstQueryHandlerInput);
			return {
				content: [
					{ type: "text" as const, text: JSON.stringify(truncateResponse(result, maxChars)) },
				],
				isError: result.error ? true : undefined,
			};
		},
	);

	// --- sia_impact --------------------------------------------------------
	server.registerTool(
		"sia_impact",
		{
			description: "Analyze the blast radius of a change to a knowledge graph entity",
			inputSchema: SiaImpactInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_impact", () => handleSiaImpact(deps.graphDb, args), maxChars);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_detect_changes ------------------------------------------------
	server.registerTool(
		"sia_detect_changes",
		{
			description: "Detect changed files from git diff and map to knowledge graph entities",
			inputSchema: SiaDetectChangesInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"sia_detect_changes",
					() => handleSiaDetectChanges(deps.graphDb, args),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_snapshot_list --------------------------------------------------
	server.registerTool(
		"sia_snapshot_list",
		{
			description: "List all branch-keyed graph snapshots",
			inputSchema: SiaSnapshotListInput.shape,
			annotations: { readOnlyHint: true },
		},
		async () => {
			if (deps) {
				return safeToolCall(
					"sia_snapshot_list",
					() => handleSiaSnapshotList(deps.graphDb),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_snapshot_restore -----------------------------------------------
	server.registerTool(
		"sia_snapshot_restore",
		{
			description: "Restore the knowledge graph from a branch snapshot",
			inputSchema: SiaSnapshotRestoreInput.shape,
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"sia_snapshot_restore",
					() => handleSiaSnapshotRestore(deps.graphDb, args),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- sia_snapshot_prune -------------------------------------------------
	server.registerTool(
		"sia_snapshot_prune",
		{
			description: "Remove branch snapshots for specified branches",
			inputSchema: SiaSnapshotPruneInput.shape,
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"sia_snapshot_prune",
					() => handleSiaSnapshotPrune(deps.graphDb, args),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- nous_state --------------------------------------------------------
	server.registerTool(
		"nous_state",
		{
			description:
				"Returns current Nous cognitive state: drift score, active preferences, recent signals, surprise count. Call at session start before any substantive work.",
			inputSchema: NousStateInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"nous_state",
					() => handleNousState(deps.graphDb, args.session_id ?? deps.sessionId),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- nous_reflect ------------------------------------------------------
	server.registerTool(
		"nous_reflect",
		{
			description:
				"Full SELF-MONITOR pass: computes drift score, compares against active Preference nodes, returns per-signal breakdown and recommended action. Call after a Discomfort Signal flag or before a major decision.",
			inputSchema: NousReflectInput.shape,
			annotations: { readOnlyHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"nous_reflect",
					() =>
						handleNousReflect(deps.graphDb, args.session_id ?? deps.sessionId, {
							context: args.context,
						}),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- nous_curiosity ----------------------------------------------------
	server.registerTool(
		"nous_curiosity",
		{
			description:
				"Explores the Sia graph for high-trust entities with low access_count — knowledge that exists but has never been retrieved. Writes results as Concern nodes. Call when a task completes early or a knowledge gap is detected.",
			inputSchema: NousCuriosityInput.shape,
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"nous_curiosity",
					() =>
						handleNousCuriosity(deps.graphDb, args.session_id ?? deps.sessionId, {
							topic: args.topic,
							depth: args.depth,
						}),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- nous_concern ------------------------------------------------------
	server.registerTool(
		"nous_concern",
		{
			description:
				'Reads open Concern nodes and surfaces them as developer-relevant insights. Filters by active Preference nodes. Call before responding to open-ended "what should I look at?" questions.',
			inputSchema: NousConcernInput.shape,
			annotations: { readOnlyHint: false },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"nous_concern",
					() => handleNousConcern(deps.graphDb, { context: args.context, person: args.person }),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	// --- nous_modify -------------------------------------------------------
	server.registerTool(
		"nous_modify",
		{
			description:
				"Creates, updates, or deprecates Preference nodes. GATED: blocked for subagents, blocked if drift > 0.90, Tier 1 preferences require explicit developer confirmation (returned as confirmationRequired: true, no mutation performed). Always provide a reason. Never call to reverse a position due to user pushback alone.",
			inputSchema: NousModifyInput.shape,
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async (args) => {
			if (deps) {
				return safeToolCall(
					"nous_modify",
					() =>
						handleNousModify(deps.graphDb, args.session_id ?? deps.sessionId, {
							action: args.action,
							preference: args.preference,
							reason: args.reason,
							existingNodeId: args.existing_node_id,
						}),
					maxChars,
				);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ error: "Sia server not initialized: missing dependencies" }),
					},
				],
				isError: true,
			};
		},
	);

	return server;
}

// ---------------------------------------------------------------------------
// startServer — convenience entry-point for stdio mode
// ---------------------------------------------------------------------------

export async function startServer(deps?: McpServerDeps): Promise<McpServer> {
	const server = createMcpServer(deps);
	const transport = new StdioServerTransport();
	try {
		await server.connect(transport);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[sia] Failed to start MCP server: ${message}`);
		throw new Error(`Sia MCP server failed to connect via stdio: ${message}`);
	}
	return server;
}
