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

This shows:
- Total entities by type (CodeSymbol, Decision, Convention, Bug, etc.)
- Total edges by type
- Community count and hierarchy depth
- Database file sizes
- Last index timestamp
- Session count
