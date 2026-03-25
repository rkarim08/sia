// Module: graph-renderer — Thin wrapper delegating to Sigma.js renderer

import { renderSigmaHtml } from "@/visualization/sigma-renderer";
import type { SubgraphData } from "@/visualization/subgraph-extract";

/**
 * Generate a self-contained HTML file with graph visualization.
 * Delegates to the Sigma.js + Graphology WebGL renderer.
 */
export function renderGraphHtml(data: SubgraphData, title?: string): string {
	return renderSigmaHtml(data, { title });
}
