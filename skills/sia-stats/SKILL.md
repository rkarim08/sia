---
name: sia-stats
description: Show SIA knowledge graph statistics — entity counts, edge counts, community structure, database sizes
---

# SIA Stats

Display statistics about the project's knowledge graph.

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
