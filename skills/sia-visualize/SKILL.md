---
name: sia-visualize
description: Generates an interactive HTML visualization of the SIA knowledge graph. Use when the user wants a static visualization file, for sharing graph views, or embedding in documentation.
---

# SIA Visualize

Generate a D3.js force-directed graph visualization of the knowledge graph.

## Steps

1. Run the graph visualization command:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/graph.ts
```

2. This generates an HTML file at `sia-graph.html` in the project root.

3. Open the file in your browser to explore the graph interactively.

## Notes

- The visualization shows entities as nodes and edges as connections
- Node size reflects importance (PageRank)
- Node color reflects type (CodeSymbol, Decision, Convention, etc.)
- Hover over nodes to see details
- The graph is a snapshot — it does not update in real time
