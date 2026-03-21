---
name: sia-digest
description: Generate a daily knowledge digest summarizing recent decisions, bugs, conventions, and changes captured by SIA
---

# SIA Digest

Generate a summary of recent knowledge captured in the graph.

## Steps

Run the digest command:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/digest.ts
```

This produces a markdown summary including:
- Decisions made in the last 24 hours
- New conventions established
- Bugs discovered and solutions applied
- Code areas with the most activity
- Community-level changes
