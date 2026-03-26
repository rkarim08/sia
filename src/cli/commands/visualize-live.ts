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
import { generateTimelineHtml } from "@/visualization/views/timeline";
import { createVizApiServer } from "@/visualization/viz-api-server";

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
 * Generate HTML for legacy views (timeline, deps, communities).
 */
async function generateLegacyViewHtml(
	db: SiaDb,
	view: "timeline" | "deps" | "communities",
	extractOpts: ExtractOpts,
): Promise<string> {
	switch (view) {
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
				`SELECT id, level, summary, member_count FROM communities
				 ORDER BY level ASC, member_count DESC
				 LIMIT 50`,
			);
			const { rows: memberRows } = await db.execute(
				`SELECT cm.entity_id, cm.community_id, gn.name AS entity_name, gn.type AS entity_type
				 FROM community_members cm
				 JOIN graph_nodes gn ON cm.entity_id = gn.id
				 WHERE gn.t_valid_until IS NULL AND gn.archived_at IS NULL
				 LIMIT 500`,
			);
			const communityData: CommunityData = {
				communities: commRows.map((r) => ({
					id: r.id as string,
					name: (r.summary as string) ?? `Community ${r.id}`,
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
	}
}

/**
 * Run the visualize-live command: start server, generate view, output URL.
 */
export async function runVisualizeLive(db: SiaDb, args: string[]): Promise<void> {
	const opts = parseVisualizeLiveArgs(args);
	const view = opts.view ?? "graph";
	const port = opts.port ?? 52742;

	// New graph view: start the API server directly (no HTML generation needed)
	if (view === "graph") {
		const projectRoot = process.cwd();
		const server = await createVizApiServer(db, projectRoot, port);
		console.log(`SIA Graph Visualizer running at: http://localhost:${server.port}`);
		console.log("Press Ctrl+C to stop.");
		// Keep the process alive so the DB stays open for API requests.
		// The server runs until the user kills the process.
		await new Promise<void>((resolve) => {
			process.on("SIGINT", () => {
				server.stop();
				resolve();
			});
			process.on("SIGTERM", () => {
				server.stop();
				resolve();
			});
		});
		return;
	}

	// Legacy views: generate HTML and spawn viz-server script
	const screenDir = resolve(".sia-graph/viz");
	mkdirSync(screenDir, { recursive: true });

	const extractOpts: ExtractOpts = {
		scope: opts.scope,
		maxNodes: opts.maxNodes,
	};
	const html = await generateLegacyViewHtml(db, view, extractOpts);

	// Write to screen dir with timestamp
	const filename = `${view}-${Date.now()}.html`;
	writeFileSync(join(screenDir, filename), html, "utf-8");

	// Start the viz server
	const serverScript = resolve(__dirname, "../../../scripts/viz-server.ts");
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
