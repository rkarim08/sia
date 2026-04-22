---
name: sia-visualize-live
description: Use when the static `/sia-visualize` HTML isn't interactive enough — launches the browser-based explorer with graph, timeline, dependency, and community views backed by live graph data.
---

# SIA Live Visualizer

Launch an interactive knowledge graph visualization in your browser.

## Usage

**Graph explorer** (default):
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts visualize-live
```

**Temporal timeline:**
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts visualize-live --view timeline
```

**Dependency map:**
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts visualize-live --view deps
```

**Community clusters:**
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts visualize-live --view communities
```

## Starting the Visualizer

```bash
skills/sia-visualize-live/scripts/start-visualizer.sh --project-dir /path/to/project
```

Open the URL shown in the output. The graph loads automatically.

## Stopping

```bash
skills/sia-visualize-live/scripts/stop-visualizer.sh $SCREEN_DIR
```

## Views

| View | What It Shows |
|---|---|
| `graph` | Interactive force-directed graph — click nodes to expand, filter by type/tier |
| `timeline` | Temporal history — when decisions were made, bugs found, entities invalidated |
| `deps` | File dependency map — imports, calls, depends_on edges between modules |
| `communities` | Community clusters — Leiden-detected module groups with summaries |

Open the URL shown in your terminal. The visualization updates live as you push new views.
