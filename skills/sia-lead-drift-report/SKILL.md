---
name: sia-lead-drift-report
description: Generate an architecture drift report — compares current codebase against captured decisions and conventions, flags where the team has diverged from intended design
---

# SIA Architecture Drift Report

Detect where the codebase has diverged from captured architectural decisions.

## Usage

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts lead-report --type drift
```

Shows: decisions not being followed, convention violations, stale architecture entities, community structure changes.
