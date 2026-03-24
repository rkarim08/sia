---
name: sia-freshness
description: Generates a freshness report for the SIA knowledge graph — identifies stale, rotten, and fresh entities. Use when checking knowledge quality, before pruning, or when results seem outdated.
---

# SIA Freshness

Generate a report on the health and freshness of knowledge in the graph.

## Steps

Run the freshness report:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/freshness.ts
```

## Report Contents

The report classifies entities into three tiers:

- **Fresh** (confidence >= 0.7): Recently validated, high-confidence knowledge
- **Stale** (0.3 <= confidence < 0.7): May need revalidation
- **Rotten** (confidence < 0.3): Likely outdated, candidates for pruning

Additional metrics:
- **Pending revalidation**: Entities flagged for review
- **Average confidence by tier**: How confident the graph is in each trust level
- **Last deep validation**: When the graph was last fully validated
- **Index coverage**: Percentage of entities with source file mappings
- **Native module status**: Whether tree-sitter is using native, WASM, or TypeScript fallback

## When To Use

- As a regular health check (weekly recommended)
- Before major refactoring to understand graph quality
- When search results seem outdated
- After `sia-prune` to confirm cleanup effectiveness
