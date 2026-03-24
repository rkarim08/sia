---
name: sia-status
description: Show SIA knowledge graph health — entity counts by type and tier, edges, communities, conflicts, and capture rate
---

# SIA Status

Display a health dashboard for the project's knowledge graph.

## Steps

Run the status command:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/status.ts
```

Or via the CLI:

```bash
sia status
```

## Output

The dashboard shows:

- **Total entities** — active (non-archived, non-invalidated) entity count
- **Total edges** — active relationship count
- **Communities** — detected community count
- **Conflicts** — number of unresolved conflict groups
- **Archived** — entities removed from active graph
- **Recent (24h)** — entities created in the last 24 hours (capture rate indicator)
- **Graph age** — days between oldest and newest entity

### By Type
Breakdown of entities by type (CodeEntity, Decision, Convention, Bug, Solution, etc.), sorted by count descending.

### By Trust Tier
Breakdown by trust tier:
- **Tier 1 (User-Direct)** — developer-stated facts
- **Tier 2 (Code-Analysis)** — deterministic AST/regex extraction
- **Tier 3 (LLM-Inferred)** — AI-generated hypotheses
- **Tier 4 (External)** — external references
