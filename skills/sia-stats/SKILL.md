---
name: sia-stats
description: Shows SIA knowledge graph statistics — entity counts, edges, communities, and database sizes. Use when checking graph health, monitoring growth, or diagnosing capacity issues.
---

# SIA Stats

Display statistics about the project's knowledge graph.

## Usage

**When to invoke:**
- Quick capacity / growth check
- Answering "how big is my graph?" / "how much has SIA captured?"
- Diagnosing why a `sia_search` returned sparse results (is the graph even populated?)

**Inputs:** No arguments; optional `include_session: true` via the MCP tool.

**Typical output:** An inline table of node counts by type, edge counts by kind, community count, database file sizes, and the timestamp of the most recent index run.

## Steps

Run the stats command:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/stats.ts
```

Or use the `sia_stats` MCP tool directly:

```
sia_stats({})
sia_stats({ include_session: true })
```

Parameters:
- **include_session** (optional): Include stats for the current session (entities created, flags raised)

## Output

This shows:
- Total entities by type (CodeSymbol, Decision, Convention, Bug, etc.)
- Total edges by type
- Community count and hierarchy depth
- Database file sizes
- Last index timestamp
- Session count
