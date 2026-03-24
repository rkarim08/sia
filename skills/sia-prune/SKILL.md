---
name: sia-prune
description: Removes archived entities from the SIA knowledge graph to reduce database size. Use when the graph grows large, after freshness reports show many stale entities, or for periodic maintenance.
---

# SIA Prune

Hard-delete archived entities from the graph to free disk space and improve query performance.

## Dry Run (Preview)

See what would be pruned without deleting anything:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/prune.ts --dry-run
```

This shows each candidate with:
- Entity name and type
- Importance score
- Days since last access

## Confirm Prune

Actually delete archived entities:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/prune.ts --confirm
```

## What Gets Pruned

Only entities that are **archived** (`archived_at IS NOT NULL`) but **not invalidated** (`t_valid_until IS NULL`) are candidates. This distinction matters:

- **Archived**: Entity decayed to irrelevance through the decay engine (low importance, not accessed recently)
- **Invalidated**: Entity was explicitly superseded by newer information (keeps historical record)

Pruning removes archived entities permanently. Invalidated entities are kept for bi-temporal history.

## When To Use

- When database size is growing large
- After `sia-freshness` identifies many rotten entities
- As periodic maintenance (monthly recommended)
- Before exporting the graph to reduce export size
