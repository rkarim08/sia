---
name: sia-compare
description: Compare the knowledge graph state between two time points — shows what was added, invalidated, and archived
---

# SIA Compare

Compare the knowledge graph between two points in time. Shows what knowledge was added, superseded, or archived.

## Usage

**Last 7 days** (default):
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts compare
```

**Between specific dates:**
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts compare --since 2026-03-01 --until 2026-03-15
```

## What It Shows

- **Added:** New entities captured in the time range
- **Invalidated:** Entities that were superseded by newer knowledge
- **Archived:** Entities that decayed below the archival threshold

## When To Use

- "What changed in the graph since the last release?"
- "What knowledge was captured this sprint?"
- "How much knowledge decayed in the last month?"
- Before a knowledge audit — understand the graph's evolution
