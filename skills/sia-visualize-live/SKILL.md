---
name: sia-visualize-live
description: Launches an interactive browser-based knowledge graph visualizer for exploring entities, dependencies, and communities. Use when the user wants to visually explore the graph or understand module relationships.
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
