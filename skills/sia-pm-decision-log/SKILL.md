---
name: sia-pm-decision-log
description: Generates a chronological decision log from SIA with dates, rationale, and alternatives considered. Use for stakeholder reviews, project documentation, or tracking architectural decision history.
---

# SIA Decision Log

Generate a formal decision log from the knowledge graph — useful for stakeholder reviews, audits, and project governance.

## Usage

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts pm-report --type decisions --since 2026-01-01
```

## Format

Each decision entry includes:
- **Date** — when the decision was captured
- **Decision** — what was decided
- **Rationale** — why this option was chosen
- **Alternatives Considered** — what was rejected and why
- **Impact** — what this affects
- **Status** — Active / Superseded / Under Review

## Output

Written to `DECISION-LOG.md` (or `--output <path>`).
