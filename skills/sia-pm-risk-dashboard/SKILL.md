---
name: sia-pm-risk-dashboard
description: Generates a technical risk dashboard from SIA — recurring bugs, conflicting decisions, fragile modules, scored by impact. Use for risk assessments, sprint planning, or identifying areas needing attention.
---

# SIA Risk Dashboard

Generate a technical risk assessment with business impact scoring.

## Usage

**When to invoke:**
- Sprint planning — "what's fragile and needs attention?"
- After a production incident, to spot adjacent risk
- PM-requested risk review before a big release

**Inputs:**
- `--output <path>` (optional, default `RISK-DASHBOARD.md`): target file
- `--since <date>` (optional): only include bugs/conflicts seen after this date

**Worked example:**

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts pm-report --type risks
```

Produces `RISK-DASHBOARD.md` with sections:

```markdown
### Critical
- **payments/charge.ts** — 4 Bug entities in the last 60 days, 1 unresolved
- **auth/session.ts** — conflict between 2 Decisions (session timeout policy)

### Moderate
- **api/rate-limit.ts** — high churn (12 commits in 30 days), no regression tests captured

### Low
- **docs/ADR-007** — stale Convention (superseded but not `t_valid_until`-closed)
```

## Risk Categories

- 🔴 **Critical** — active bugs affecting users, unresolved conflicts
- 🟡 **Moderate** — recurring issues, high-churn areas, stale conventions
- 🟢 **Low** — documentation gaps, minor coverage issues

## Output

Written to `RISK-DASHBOARD.md` (or `--output <path>`).
