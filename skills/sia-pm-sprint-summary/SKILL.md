---
name: sia-pm-sprint-summary
description: Use at sprint close or before standup; substitutes for manual weekly-recap writing.
---

# SIA Sprint Summary

Generate a PM-ready sprint summary from the knowledge graph.

## Usage

**When to invoke:**
- Sprint review / retro prep
- End-of-sprint status report for non-engineers
- Weekly leadership briefing

**Inputs:**
- `--since <date>` (required): sprint start date
- `--until <date>` (optional, default today): sprint end date
- `--output <path>` (optional, default `SPRINT-SUMMARY.md`): target file

**Worked example:**

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts pm-report --type sprint --since 2026-03-10 --until 2026-03-23
```

Produces `SPRINT-SUMMARY.md`:

```markdown
## Executive Summary
Sprint 24 shipped the rate-limiting feature and resolved the payment-retry bug.

## Key Decisions
- **Use Redis for rate limiting** — chose over Postgres advisory locks for burst-load tolerance.

## Bugs Found & Fixed
- Double-charge on payment retry — root cause: missing idempotency key; fixed via `orders/charge.ts:42`.

## Metrics
- 14 entities captured · 8 Decisions · 3 Bugs · 3 Solutions
```

## Sections

1. **Executive Summary** — 2-3 sentence overview
2. **Key Decisions** — architectural choices with rationale (plain language)
3. **Bugs Found & Fixed** — with business impact
4. **Open Issues** — unresolved bugs with risk level
5. **Risk Areas** — modules that need attention next sprint
6. **Metrics** — entity counts, change velocity, bug rate

## Output

Written to `SPRINT-SUMMARY.md` (or `--output <path>`).
