---
name: sia-qa-report
description: Generates a QA-focused report from SIA — changes since last test cycle, risky areas, and recommended test priorities. Use before QA cycles, for test planning, or risk-based testing decisions.
---

# SIA QA Report

Generate a testing-focused report from the knowledge graph.

## Usage

**When to invoke:**
- Kicking off a QA cycle — "what should we test first?"
- Release readiness review
- Risk-based testing prioritisation

**Inputs:**
- `--since <date>` (required): start of the reporting window
- `--output <path>` (optional, default `QA-REPORT.md`)

**Worked example:**

```bash
$ bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts qa-report --since 2026-03-15
[qa-report] Wrote QA-REPORT.md — 6 risk areas, 14 priority tests, 3 coverage gaps
```

Produces a markdown report with sections: Changes since date, Risk assessment, Bug activity, Test recommendations, Coverage gaps.

## What It Shows

1. **Changes since date** — decisions, code changes, new features grouped by module
2. **Risk assessment** — bug density + change velocity per area
3. **Bug activity** — bugs found, fixed, and still open
4. **Test recommendations** — what to test first, specific test cases from bug history
5. **Coverage gaps** — areas with code changes but no corresponding test changes

## Output

Written to `QA-REPORT.md` in the project root (or `--output <path>`).
