// Module: graph — CLI command to generate knowledge graph visualization

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SiaDb } from "@/graph/db-interface";
import { renderGraphHtml } from "@/visualization/graph-renderer";
import { type ExtractOpts, extractSubgraph } from "@/visualization/subgraph-extract";

export interface GraphCommandOpts {
	output?: string;
	scope?: string;
	nodeType?: string;
	maxNodes?: number;
}

export function parseGraphArgs(args: string[]): GraphCommandOpts {
	const opts: GraphCommandOpts = {};
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--max-nodes" && args[i + 1]) {
			opts.maxNodes = parseInt(args[++i], 10);
		} else if (args[i] === "--scope" && args[i + 1]) {
			opts.scope = args[++i];
		} else if (args[i] === "--node-type" && args[i + 1]) {
			opts.nodeType = args[++i];
		} else if (args[i] === "--output" && args[i + 1]) {
			opts.output = args[++i];
		}
	}
	return opts;
}

/**
 * Generate a knowledge graph visualization as a self-contained HTML file.
 *
 * 1. Extracts a subgraph according to the provided options.
 * 2. Renders the subgraph as a self-contained HTML document with D3.js.
 * 3. Writes the HTML to the output path.
 * 4. Returns the absolute path of the written file.
 */
export async function generateGraphVisualization(
	db: SiaDb,
	opts?: GraphCommandOpts,
): Promise<string> {
	const extractOpts: ExtractOpts = {
		scope: opts?.scope,
		nodeType: opts?.nodeType,
		maxNodes: opts?.maxNodes,
	};

	const data = await extractSubgraph(db, extractOpts);

	// Build a descriptive title from the options
	let title = "Sia Knowledge Graph";
	if (opts?.scope) {
		title = `Sia Graph — ${opts.scope}`;
	} else if (opts?.nodeType) {
		title = `Sia Graph — ${opts.nodeType} entities`;
	}

	const html = renderGraphHtml(data, title);

	const outputPath = resolve(opts?.output ?? "./sia-graph.html");
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, html, "utf-8");

	return outputPath;
}
