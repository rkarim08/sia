---
name: sia-health
description: Use when opening a new workspace, after major refactors, or on `[Nous] Drift warning`. Shows entity counts, conflicts, capture rate, and tier breakdown as a single dashboard.
---

# SIA Health

Unified health + stats dashboard for the project's knowledge graph. Consolidates the former `/sia-stats` (graph capacity / growth) and `/sia-status` (capture rate / conflicts / tier breakdown) into one view.

## Usage

**When to invoke:**
- User asks "is SIA healthy?" / "how's my graph?"
- Start of any new workspace — before deciding whether the graph is mature enough for `sia_community` calls
- After a major refactor — verify capture rate
- On a `[Nous] Drift warning`
- Checking capture rate during a busy sprint
- Quick conflict count — "do we have any unresolved conflicts?"
- Answering "how big is my graph?" / "how much has SIA captured?"
- Diagnosing why a `sia_search` returned sparse results (is the graph even populated?)

**Inputs:** No arguments; optional `include_session: true` via the MCP tool.

**Typical output:** A dashboard with totals (entities, edges, communities, conflicts, archived), recent capture rate (24h), graph age, plus node counts by type, edge counts by kind, community count, database file sizes, and breakdowns by trust tier.

## Steps

Run either CLI command (both are preserved for compatibility):

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/status.ts
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/stats.ts
```

Or via the CLI:

```bash
sia status
```

Or use the `sia_stats` MCP tool directly:

```
sia_stats({})
sia_stats({ include_session: true })
```

Parameters:
- **include_session** (optional): Include stats for the current session (entities created, flags raised)

## Output

### Dashboard totals

- **Total entities** — active (non-archived, non-invalidated) entity count
- **Total edges** — active relationship count
- **Communities** — detected community count
- **Conflicts** — number of unresolved conflict groups
- **Archived** — entities removed from active graph
- **Recent (24h)** — entities created in the last 24 hours (capture rate indicator)
- **Graph age** — days between oldest and newest entity

### Capacity / growth

- Total entities by type (CodeSymbol, Decision, Convention, Bug, etc.)
- Total edges by type
- Community count and hierarchy depth
- Database file sizes
- Last index timestamp
- Session count

### By Type
Breakdown of entities by type (CodeEntity, Decision, Convention, Bug, Solution, etc.), sorted by count descending.

### By Trust Tier
Breakdown by trust tier:
- **Tier 1 (User-Direct)** — developer-stated facts
- **Tier 2 (Code-Analysis)** — deterministic AST/regex extraction
- **Tier 3 (LLM-Inferred)** — AI-generated hypotheses
- **Tier 4 (External)** — external references
