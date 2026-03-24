// Module: visualize-live — CLI command to start interactive browser visualizer

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SiaDb } from "@/graph/db-interface";
import { type ExtractOpts, extractSubgraph } from "@/visualization/subgraph-extract";
import {
	type CommunityData,
	generateCommunityClusterHtml,
} from "@/visualization/views/community-clusters";
import { generateDependencyMapHtml } from "@/visualization/views/dependency-map";
import { generateGraphExplorerHtml } from "@/visualization/views/graph-explorer";
import { generateTimelineHtml } from "@/visualization/views/timeline";

export type ViewType = "graph" | "timeline" | "deps" | "communities";

export interface VisualizeLiveOpts {
	view?: ViewType;
	port?: number;
	scope?: string;
	maxNodes?: number;
}

/**
 * Parse CLI args into VisualizeLiveOpts.
 */
export function parseVisualizeLiveArgs(args: string[]): VisualizeLiveOpts {
	const opts: VisualizeLiveOpts = {};
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--view" && args[i + 1]) {
			opts.view = args[++i] as ViewType;
		} else if (args[i] === "--port" && args[i + 1]) {
			opts.port = parseInt(args[++i], 10);
		} else if (args[i] === "--scope" && args[i + 1]) {
			opts.scope = args[++i];
		} else if (args[i] === "--max-nodes" && args[i + 1]) {
			opts.maxNodes = parseInt(args[++i], 10);
		}
	}
	return opts;
}

/**
 * Generate the appropriate view HTML based on the selected view type.
 */
export async function generateViewHtml(
	db: SiaDb,
	view: ViewType,
	extractOpts: ExtractOpts,
): Promise<string> {
	switch (view) {
		case "graph": {
			const data = await extractSubgraph(db, extractOpts);
			return generateGraphExplorerHtml(data);
		}
		case "timeline": {
			const data = await extractSubgraph(db, extractOpts);
			const events = data.nodes.map((n) => ({
				id: n.id,
				type: n.type,
				name: n.name,
				created_at: Date.now() - Math.random() * 86400_000 * 30, // placeholder
				kind: n.type,
			}));
			return generateTimelineHtml(events);
		}
		case "deps": {
			const data = await extractSubgraph(db, {
				...extractOpts,
				nodeType: extractOpts.nodeType ?? "FileNode",
			});
			return generateDependencyMapHtml(data, { rootFile: extractOpts.scope });
		}
		case "communities": {
			// Fetch community data from the graph
			const { rows: commRows } = await db.execute(
				`SELECT id, name, level, summary, member_count FROM communities
				 WHERE t_valid_until IS NULL
				 ORDER BY level ASC, member_count DESC
				 LIMIT 50`,
			);
			const { rows: memberRows } = await db.execute(
				`SELECT entity_id, community_id, entity_name, entity_type FROM community_members
				 WHERE t_valid_until IS NULL
				 LIMIT 500`,
			);
			const communityData: CommunityData = {
				communities: commRows.map((r) => ({
					id: r.id as string,
					name: r.name as string,
					level: (r.level as number) ?? 1,
					summary: (r.summary as string) ?? "",
					memberCount: (r.member_count as number) ?? 0,
				})),
				members: memberRows.map((r) => ({
					entityId: r.entity_id as string,
					communityId: r.community_id as string,
					entityName: r.entity_name as string,
					entityType: r.entity_type as string,
				})),
			};
			return generateCommunityClusterHtml(communityData);
		}
		default:
			throw new Error(`Unknown view type: ${view}`);
	}
}

/**
 * Run the visualize-live command: start server, generate view, output URL.
 */
export async function runVisualizeLive(db: SiaDb, args: string[]): Promise<void> {
	const opts = parseVisualizeLiveArgs(args);
	const view = opts.view ?? "graph";
	const port = opts.port ?? 52742;

	// Create screen directory
	const screenDir = resolve(".sia-graph/viz");
	mkdirSync(screenDir, { recursive: true });

	// Generate HTML view
	const extractOpts: ExtractOpts = {
		scope: opts.scope,
		maxNodes: opts.maxNodes,
	};
	const html = await generateViewHtml(db, view, extractOpts);

	// Write to screen dir with timestamp
	const filename = `${view}-${Date.now()}.html`;
	writeFileSync(join(screenDir, filename), html, "utf-8");

	// Start the viz server
	const serverScript = resolve(__dirname, "../../scripts/viz-server.ts");
	const child = spawn(
		"bun",
		["run", serverScript, "--screen-dir", screenDir, "--port", String(port)],
		{
			stdio: "pipe",
			detached: true,
		},
	);

	child.stdout?.on("data", (data: Buffer) => {
		const msg = data.toString().trim();
		try {
			const info = JSON.parse(msg);
			if (info.type === "server-started") {
				console.log(`SIA Graph Visualizer running at: ${info.url}`);
				console.log(`View: ${view} | Screen dir: ${screenDir}`);
			}
		} catch {
			console.log(msg);
		}
	});

	child.stderr?.on("data", (data: Buffer) => {
		console.error(data.toString().trim());
	});

	child.unref();
}
