// Module: server — MCP server scaffold with 6 tool registrations
//
// Read-only against graph.db.  Only writes go to session_flags.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { SiaDb } from "@/graph/db-interface";
import type { SiaConfig } from "@/shared/config";
import { handleSiaSearch } from "@/mcp/tools/sia-search";
import { handleSiaByFile } from "@/mcp/tools/sia-by-file";
import { handleSiaExpand } from "@/mcp/tools/sia-expand";
import { handleSiaCommunity } from "@/mcp/tools/sia-community";
import { handleSiaAtTime } from "@/mcp/tools/sia-at-time";
import { handleSiaFlag } from "@/mcp/tools/sia-flag";

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
] as const;

export type SiaToolName = (typeof TOOL_NAMES)[number];

// ---------------------------------------------------------------------------
// McpServerDeps — optional dependencies for wiring real tool handlers
// ---------------------------------------------------------------------------

export interface McpServerDeps {
	graphDb: SiaDb;
	bridgeDb: SiaDb | null;
	metaDb: SiaDb | null;
	embedder: unknown | null;
	config: SiaConfig;
}

// ---------------------------------------------------------------------------
// createMcpServer — builds and returns a configured McpServer
// ---------------------------------------------------------------------------

export function createMcpServer(deps?: McpServerDeps): McpServer {
	const server = new McpServer({ name: "sia", version: "0.1.0" });

	// --- sia_search --------------------------------------------------------
	server.tool(
		"sia_search",
		"Semantic search across the Sia knowledge graph",
		SiaSearchInput.shape,
		async (args) => {
			if (deps) {
				const result = await handleSiaSearch(deps.graphDb, args);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return { content: [{ type: "text" as const, text: `stub: sia_search ${JSON.stringify(args)}` }] };
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
			return { content: [{ type: "text" as const, text: `stub: sia_by_file ${JSON.stringify(args)}` }] };
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
			return { content: [{ type: "text" as const, text: `stub: sia_expand ${JSON.stringify(args)}` }] };
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
			return { content: [{ type: "text" as const, text: `stub: sia_community ${JSON.stringify(args)}` }] };
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
			return { content: [{ type: "text" as const, text: `stub: sia_at_time ${JSON.stringify(args)}` }] };
		},
	);

	// --- sia_flag ----------------------------------------------------------
	server.tool(
		"sia_flag",
		"Flag current session for human review (writes to session_flags only)",
		SiaFlagInput.shape,
		async (args) => {
			if (deps) {
				const sessionId = process.env.SIA_SESSION_ID ?? "default";
				const result = await handleSiaFlag(
					deps.graphDb,
					args,
					{ enableFlagging: deps.config.enableFlagging, sessionId },
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			}
			return { content: [{ type: "text" as const, text: `stub: sia_flag ${JSON.stringify(args)}` }] };
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
