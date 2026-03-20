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
// createMcpServer — builds and returns a configured McpServer
// ---------------------------------------------------------------------------

export function createMcpServer(deps?: McpServerDeps): McpServer {
	const server = new McpServer({ name: "sia", version: "0.2.0" });

	// --- sia_search --------------------------------------------------------
	server.tool(
		"sia_search",
		"Semantic search across the Sia knowledge graph",
		SiaSearchInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaSearch(deps.graphDb, args, deps.embedder ?? undefined);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_search ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_by_file -------------------------------------------------------
	server.tool(
		"sia_by_file",
		"Retrieve knowledge graph nodes associated with a file",
		SiaByFileInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaByFile(deps.graphDb, args);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_by_file ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_expand --------------------------------------------------------
	server.tool(
		"sia_expand",
		"Expand an entity's neighbourhood in the knowledge graph",
		SiaExpandInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaExpand(deps.graphDb, args);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_expand ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_community -----------------------------------------------------
	server.tool(
		"sia_community",
		"Retrieve community-level summaries from the knowledge graph",
		SiaCommunityInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaCommunity(deps.graphDb, args);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_community ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_at_time -------------------------------------------------------
	server.tool(
		"sia_at_time",
		"Query the knowledge graph at a point in time",
		SiaAtTimeInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaAtTime(deps.graphDb, args);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_at_time ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_flag ----------------------------------------------------------
	server.tool(
		"sia_flag",
		"Flag current session for human review (writes to session_flags only)",
		SiaFlagInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaFlag(deps.graphDb, args, {
					enableFlagging: deps.config.enableFlagging,
					sessionId: deps.sessionId,
				});
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_flag ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_backlinks -----------------------------------------------------
	server.tool(
		"sia_backlinks",
		"Find all incoming edges (backlinks) to a knowledge graph node",
		SiaBacklinksInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaBacklinks(deps.graphDb, args);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_backlinks ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_note ----------------------------------------------------------
	server.tool(
		"sia_note",
		"Create a developer-authored knowledge entry in the graph",
		SiaNoteInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaNote(deps.graphDb, args);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_note ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_execute -------------------------------------------------------
	server.tool(
		"sia_execute",
		"Execute code in an isolated sandbox",
		SiaExecuteInput.shape,
		async (args) => {
			if (deps) {
				const throttle = new ProgressiveThrottle(deps.graphDb, {
					normalMax: deps.config.throttleNormalMax,
					reducedMax: deps.config.throttleReducedMax,
				});
				const result = await handleSiaExecute(
					deps.graphDb,
					args,
					deps.embedder as Embedder,
					throttle,
					deps.sessionId,
					{
						sandboxTimeoutMs: deps.config.sandboxTimeoutMs,
						sandboxOutputMaxBytes: deps.config.sandboxOutputMaxBytes,
						contextModeThreshold: deps.config.contextModeThreshold,
						contextModeTopK: deps.config.contextModeTopK,
					},
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_execute ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_execute_file --------------------------------------------------
	server.tool(
		"sia_execute_file",
		"Execute an existing file in a sandbox subprocess",
		SiaExecuteFileInput.shape,
		async (args) => {
			if (deps) {
				const throttle = new ProgressiveThrottle(deps.graphDb, {
					normalMax: deps.config.throttleNormalMax,
					reducedMax: deps.config.throttleReducedMax,
				});
				const result = await handleSiaExecuteFile(
					deps.graphDb,
					args,
					deps.embedder as Embedder,
					throttle,
					deps.sessionId,
					{
						sandboxTimeoutMs: deps.config.sandboxTimeoutMs,
						sandboxOutputMaxBytes: deps.config.sandboxOutputMaxBytes,
						contextModeThreshold: deps.config.contextModeThreshold,
						contextModeTopK: deps.config.contextModeTopK,
					},
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [
					{ type: "text" as const, text: `stub: sia_execute_file ${JSON.stringify(args)}` },
				],
			};
		},
	);

	// --- sia_index ---------------------------------------------------------
	server.tool(
		"sia_index",
		"Index markdown/text content by chunking and scanning for entity references",
		SiaIndexInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaIndex(
					deps.graphDb,
					args,
					deps.embedder as Embedder,
					deps.sessionId,
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_index ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_batch_execute -------------------------------------------------
	server.tool(
		"sia_batch_execute",
		"Execute multiple operations in one call with precedes edges",
		SiaBatchExecuteInput.shape,
		async (args) => {
			if (deps) {
				const throttle = new ProgressiveThrottle(deps.graphDb, {
					normalMax: deps.config.throttleNormalMax,
					reducedMax: deps.config.throttleReducedMax,
				});
				const result = await handleSiaBatchExecute(
					deps.graphDb,
					args as Parameters<typeof handleSiaBatchExecute>[1],
					deps.embedder as Embedder,
					throttle,
					deps.sessionId,
					{ timeoutPerOp: deps.config.sandboxTimeoutMs },
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [
					{ type: "text" as const, text: `stub: sia_batch_execute ${JSON.stringify(args)}` },
				],
			};
		},
	);

	// --- sia_fetch_and_index -----------------------------------------------
	server.tool(
		"sia_fetch_and_index",
		"Fetch a URL, convert to markdown, and index via contentTypeChunker",
		SiaFetchAndIndexInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaFetchAndIndex(
					deps.graphDb,
					args,
					deps.embedder as Embedder,
					deps.sessionId,
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [
					{ type: "text" as const, text: `stub: sia_fetch_and_index ${JSON.stringify(args)}` },
				],
			};
		},
	);

	// --- sia_stats ---------------------------------------------------------
	server.tool(
		"sia_stats",
		"Return graph metrics: node/edge counts by type, optional session stats",
		SiaStatsInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaStats(deps.graphDb, args, deps.sessionId);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_stats ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_doctor --------------------------------------------------------
	server.tool(
		"sia_doctor",
		"Run diagnostic checks on the Sia installation",
		SiaDoctorInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaDoctor(deps.graphDb, args);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_doctor ${JSON.stringify(args)}` }],
			};
		},
	);

	// --- sia_upgrade -------------------------------------------------------
	server.tool(
		"sia_upgrade",
		"Self-update Sia to the latest version",
		SiaUpgradeInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaUpgrade(deps.graphDb, args, {
					upgradeReleaseUrl: deps.config.upgradeReleaseUrl ?? undefined,
				});
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return {
				content: [{ type: "text" as const, text: `stub: sia_upgrade ${JSON.stringify(args)}` }],
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

	// --- Health-check HTTP server ---
	const healthPort = Number(process.env.SIA_HEALTH_PORT ?? 52731);
	Bun.serve({
		port: healthPort,
		fetch() {
			return new Response(JSON.stringify({ status: "ok" }), {
				headers: { "Content-Type": "application/json" },
			});
		},
	});

	return server;
}
