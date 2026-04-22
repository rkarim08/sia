---
name: sia-history
description: Explores how the knowledge graph evolved over time with temporal filtering. Use when reviewing recent decisions, tracking knowledge evolution, or investigating when something was captured.
---

# SIA History

Interactive temporal exploration of the project's knowledge graph.

## Usage

**Last 7 days** (default):
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts history
```

**Since a specific date:**
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts history --since 2026-03-01
```

**Filter by type:**
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts history --types Decision,Convention
```

**Filter by file:**
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts history --file src/auth/login.ts
```

## When To Use

- "What decisions were made this week?"
- "Show me the bug history for this module"
- "What changed in the graph since last release?"
- "What conventions were established recently?"

## Worked Example

```
$ /sia-history --since 2026-04-14 --types Decision,Bug
2026-04-16  Decision  Use Redis for rate limiting
2026-04-17  Bug       Double-charge on payment retry
2026-04-18  Decision  Drop jQuery from docs-site
2026-04-20  Bug       Session timeout inconsistent across pods
```

## Also Available

- `sia_at_time` MCP tool — query the graph at a specific point in time
- `/sia-compare` — compare graph state between two time points
