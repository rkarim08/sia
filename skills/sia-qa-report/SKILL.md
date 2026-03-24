---
name: sia-qa-report
description: Generates a QA-focused report from SIA — changes since last test cycle, risky areas, and recommended test priorities. Use before QA cycles, for test planning, or risk-based testing decisions.
---

# SIA QA Report

Generate a testing-focused report from the knowledge graph.

## Usage

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts qa-report --since 2026-03-15
```

## What It Shows

1. **Changes since date** — decisions, code changes, new features grouped by module
2. **Risk assessment** — bug density + change velocity per area
3. **Bug activity** — bugs found, fixed, and still open
4. **Test recommendations** — what to test first, specific test cases from bug history
5. **Coverage gaps** — areas with code changes but no corresponding test changes

## Output

Written to `QA-REPORT.md` in the project root (or `--output <path>`).
