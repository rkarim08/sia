// Module: graph-explorer — Thin wrapper delegating to Sigma.js renderer
//
// Previously contained a full D3.js-based interactive explorer. Now delegates
// to the shared Sigma.js + Graphology WebGL renderer for consistency and
// better performance on large graphs.

import { renderSigmaHtml } from "@/visualization/sigma-renderer";
import type { SubgraphData } from "@/visualization/subgraph-extract";

/**
 * Generate a self-contained interactive graph explorer HTML page.
 * Delegates to the Sigma.js + Graphology WebGL renderer.
 */
export function generateGraphExplorerHtml(data: SubgraphData, opts?: { title?: string }): string {
	return renderSigmaHtml(data, { title: opts?.title ?? "SIA Graph Explorer" });
}
