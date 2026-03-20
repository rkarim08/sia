// Module: server — MCP server with 16 tool registrations
//
// All handlers are wired to real implementations via McpServerDeps.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import { handleSiaAtTime } from "@/mcp/tools/sia-at-time";
import { handleSiaBacklinks } from "@/mcp/tools/sia-backlinks";
import { handleSiaBatchExecute } from "@/mcp/tools/sia-batch-execute";
import { handleSiaByFile } from "@/mcp/tools/sia-by-file";
import { handleSiaCommunity } from "@/mcp/tools/sia-community";
import { handleSiaDoctor } from "@/mcp/tools/sia-doctor";
import { handleSiaExecute } from "@/mcp/tools/sia-execute";
import { handleSiaExecuteFile } from "@/mcp/tools/sia-execute-file";
import { handleSiaExpand } from "@/mcp/tools/sia-expand";
import { handleSiaFetchAndIndex } from "@/mcp/tools/sia-fetch-and-index";
import { handleSiaFlag } from "@/mcp/tools/sia-flag";
import { handleSiaIndex } from "@/mcp/tools/sia-index";
import { handleSiaNote } from "@/mcp/tools/sia-note";
import { handleSiaSearch } from "@/mcp/tools/sia-search";
import { handleSiaStats } from "@/mcp/tools/sia-stats";
import { handleSiaUpgrade } from "@/mcp/tools/sia-upgrade";
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

export const SiaUpgradeInput = z.object({
	target_version: z.string().optional(),
	dry_run: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Tool names — single source of truth
// ---------------------------------------------------------------------------

export const TOOL_NAMES = [
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
}

// ---------------------------------------------------------------------------
// safeToolCall — wrap a handler call with try-catch, returning structured error
// ---------------------------------------------------------------------------

/** Wrap a handler call with try-catch, returning structured error on failure. */
async function safeToolCall<T>(
	toolName: string,
	fn: () => Promise<T>,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
	try {
		const result = await fn();
		return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
	} catch (err) {
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
	const server = new McpServer({ name: "sia", version: "0.2.0" });

	// --- sia_search --------------------------------------------------------
	server.registerTool(
		"sia_search",
		{
			description: "Semantic search across the Sia knowledge graph",
			inputSchema: SiaSearchInput.shape,
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_search", () =>
					handleSiaSearch(deps.graphDb, args, deps.embedder ?? undefined),
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
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_by_file", () => handleSiaByFile(deps.graphDb, args));
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
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_expand", () => handleSiaExpand(deps.graphDb, args));
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
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_community", () => handleSiaCommunity(deps.graphDb, args));
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
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_at_time", () => handleSiaAtTime(deps.graphDb, args));
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
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_flag", () =>
					handleSiaFlag(deps.graphDb, args, {
						enableFlagging: deps.config.enableFlagging,
						sessionId: deps.sessionId,
					}),
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
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_backlinks", () => handleSiaBacklinks(deps.graphDb, args));
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
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_note", () => handleSiaNote(deps.graphDb, args));
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
		},
		async (args) => {
			if (deps) {
				if (!deps.embedder) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									error: "Embedder not available. Run sia_doctor to check ONNX status.",
								}),
							},
						],
						isError: true,
					};
				}
				const embedder = deps.embedder;
				const throttle = new ProgressiveThrottle(deps.graphDb, {
					normalMax: deps.config.throttleNormalMax,
					reducedMax: deps.config.throttleReducedMax,
				});
				return safeToolCall("sia_execute", () =>
					handleSiaExecute(
						deps.graphDb,
						args,
						embedder,
						throttle,
						deps.sessionId,
						{
							sandboxTimeoutMs: deps.config.sandboxTimeoutMs,
							sandboxOutputMaxBytes: deps.config.sandboxOutputMaxBytes,
							contextModeThreshold: deps.config.contextModeThreshold,
							contextModeTopK: deps.config.contextModeTopK,
						},
					),
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
		},
		async (args) => {
			if (deps) {
				if (!deps.embedder) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									error: "Embedder not available. Run sia_doctor to check ONNX status.",
								}),
							},
						],
						isError: true,
					};
				}
				const embedderFile = deps.embedder;
				const throttle = new ProgressiveThrottle(deps.graphDb, {
					normalMax: deps.config.throttleNormalMax,
					reducedMax: deps.config.throttleReducedMax,
				});
				return safeToolCall("sia_execute_file", () =>
					handleSiaExecuteFile(
						deps.graphDb,
						args,
						embedderFile,
						throttle,
						deps.sessionId,
						{
							sandboxTimeoutMs: deps.config.sandboxTimeoutMs,
							sandboxOutputMaxBytes: deps.config.sandboxOutputMaxBytes,
							contextModeThreshold: deps.config.contextModeThreshold,
							contextModeTopK: deps.config.contextModeTopK,
						},
					),
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
		},
		async (args) => {
			if (deps) {
				if (!deps.embedder) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									error: "Embedder not available. Run sia_doctor to check ONNX status.",
								}),
							},
						],
						isError: true,
					};
				}
				const embedderIndex = deps.embedder;
				return safeToolCall("sia_index", () =>
					handleSiaIndex(deps.graphDb, args, embedderIndex, deps.sessionId),
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
		},
		async (args) => {
			if (deps) {
				if (!deps.embedder) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									error: "Embedder not available. Run sia_doctor to check ONNX status.",
								}),
							},
						],
						isError: true,
					};
				}
				const embedderBatch = deps.embedder;
				const throttle = new ProgressiveThrottle(deps.graphDb, {
					normalMax: deps.config.throttleNormalMax,
					reducedMax: deps.config.throttleReducedMax,
				});
				return safeToolCall("sia_batch_execute", () =>
					handleSiaBatchExecute(
						deps.graphDb,
						args as Parameters<typeof handleSiaBatchExecute>[1],
						embedderBatch,
						throttle,
						deps.sessionId,
						{ timeoutPerOp: deps.config.sandboxTimeoutMs },
					),
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
		},
		async (args) => {
			if (deps) {
				if (!deps.embedder) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									error: "Embedder not available. Run sia_doctor to check ONNX status.",
								}),
							},
						],
						isError: true,
					};
				}
				const embedderFetch = deps.embedder;
				return safeToolCall("sia_fetch_and_index", () =>
					handleSiaFetchAndIndex(deps.graphDb, args, embedderFetch, deps.sessionId),
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
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_stats", () =>
					handleSiaStats(deps.graphDb, args, deps.sessionId),
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
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_doctor", () => handleSiaDoctor(deps.graphDb, args));
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
		},
		async (args) => {
			if (deps) {
				return safeToolCall("sia_upgrade", () =>
					handleSiaUpgrade(deps.graphDb, args, {
						upgradeReleaseUrl: deps.config.upgradeReleaseUrl ?? undefined,
					}),
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
	await server.connect(transport);

	// --- Health-check HTTP server (non-essential — failure should not crash MCP) ---
	const healthPort = Number(process.env.SIA_HEALTH_PORT ?? 52731);
	try {
		Bun.serve({
			port: healthPort,
			fetch() {
				return new Response(JSON.stringify({ status: "ok" }), {
					headers: { "Content-Type": "application/json" },
				});
			},
		});
	} catch (err) {
		console.error(
			`[sia] Health server failed to bind on port ${healthPort}: ${(err as Error).message}. ` +
				"MCP server will continue without health endpoint. Set SIA_HEALTH_PORT to an available port.",
		);
	}

	return server;
}
