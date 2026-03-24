---
name: sia-pm-risk-dashboard
description: Generates a technical risk dashboard from SIA — recurring bugs, conflicting decisions, fragile modules, scored by impact. Use for risk assessments, sprint planning, or identifying areas needing attention.
---

# SIA Risk Dashboard

Generate a technical risk assessment with business impact scoring.

## Usage

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts pm-report --type risks
```

## Risk Categories

- 🔴 **Critical** — active bugs affecting users, unresolved conflicts
- 🟡 **Moderate** — recurring issues, high-churn areas, stale conventions
- 🟢 **Low** — documentation gaps, minor coverage issues

## Output

Written to `RISK-DASHBOARD.md` (or `--output <path>`).
