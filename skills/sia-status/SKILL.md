---
name: sia-status
description: Shows SIA knowledge graph health — entity counts by type and tier, conflicts, and capture rate. Use for quick health checks, monitoring, or when the user asks about SIA status.
---

# SIA Status

Display a health dashboard for the project's knowledge graph.

## Usage

**When to invoke:**
- User asks "is SIA healthy?" / "how's my graph?"
- Checking capture rate during a busy sprint
- Quick conflict count — "do we have any unresolved conflicts?"

**Inputs:** No arguments.

**Typical output:** A dashboard with totals (entities, edges, communities, conflicts, archived), recent capture rate (24h), graph age, plus breakdowns by entity type and trust tier.

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
