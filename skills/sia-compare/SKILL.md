---
name: sia-compare
description: Use when auditing what changed in the graph between two points in time — shows added, invalidated, and archived entities. Pair with `/sia-history` when you need narrative context around the diff.
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

## Worked Example

```
$ /sia-compare --since 2026-03-01 --until 2026-03-15
Added (14): 4 Decisions, 3 Conventions, 5 Bugs, 2 Solutions
Invalidated (3): "Use jQuery in docs-site" (superseded 2026-03-08), ...
Archived (2): stale CodeSymbol entries below decay threshold
```
