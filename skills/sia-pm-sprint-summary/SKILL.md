---
name: sia-pm-sprint-summary
description: Generates a sprint summary report from SIA in plain language — decisions made, bugs fixed, features delivered. Use for sprint reviews, status updates, or project manager briefings.
---

# SIA Sprint Summary

Generate a PM-ready sprint summary from the knowledge graph.

## Usage

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts pm-report --type sprint --since 2026-03-10 --until 2026-03-23
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
