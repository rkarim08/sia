---
name: sia-pm
description: Use before sprint close (summary), release readiness review (risk), or stakeholder review (decision-log). Generates PM-facing reports. `--type` subarg selects between `sprint-summary`, `risk-dashboard`, and `decision-log`.
---

# SIA PM Reports

Generate PM-facing reports from the knowledge graph. One skill, three report types selected via `--type`.

## Usage

Select the report with `--type`:

- `--type sprint-summary` — PM-ready sprint summary (default audience: PM / leadership)
- `--type risk-dashboard` — technical risk dashboard with business impact scoring
- `--type decision-log` — formal decision log for stakeholder review or audit

**Worked example:**

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts pm-report --type sprint --since 2026-03-10 --until 2026-03-23
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts pm-report --type risks
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts pm-report --type decisions --since 2026-01-01
```

---

## `--type sprint-summary`

Generate a PM-ready sprint summary from the knowledge graph.

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

**Sections:**
1. **Executive Summary** — 2-3 sentence overview
2. **Key Decisions** — architectural choices with rationale (plain language)
3. **Bugs Found & Fixed** — with business impact
4. **Open Issues** — unresolved bugs with risk level
5. **Risk Areas** — modules that need attention next sprint
6. **Metrics** — entity counts, change velocity, bug rate

**Output:** Written to `SPRINT-SUMMARY.md` (or `--output <path>`).

---

## `--type risk-dashboard`

Generate a technical risk assessment with business impact scoring. **Use before release readiness review, before approving a major merge, or on-demand when the team is debating whether to ship.** Read alongside `/sia-freshness` for a full go/no-go signal.

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

**Risk Categories:**
- 🔴 **Critical** — active bugs affecting users, unresolved conflicts
- 🟡 **Moderate** — recurring issues, high-churn areas, stale conventions
- 🟢 **Low** — documentation gaps, minor coverage issues

**Output:** Written to `RISK-DASHBOARD.md` (or `--output <path>`).

---

## `--type decision-log`

Generate a formal decision log from the knowledge graph — useful for stakeholder reviews, audits, and project governance.

**When to invoke:**
- Stakeholder review / quarterly governance check
- Onboarding a new team lead who needs the decision history
- Audit trail needed for a compliance or post-mortem review

**Inputs:**
- `--since <date>` (optional, default 90 days ago): ISO date to filter Decision entities
- `--until <date>` (optional, default today): ISO date upper bound
- `--output <path>` (optional, default `DECISION-LOG.md`): target file

**Worked example:**

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts pm-report --type decisions --since 2026-01-01
```

Produces `DECISION-LOG.md` with entries like:

```markdown
## 2026-02-14 — Use Redis for distributed rate limiting
**Rationale:** Single-node counter doesn't survive pod restarts.
**Alternatives considered:** Postgres advisory locks (rejected: lock contention under burst load).
**Impact:** api-gateway, shared-middleware
**Status:** Active
```

**Format — each decision entry includes:**
- **Date** — when the decision was captured
- **Decision** — what was decided
- **Rationale** — why this option was chosen
- **Alternatives Considered** — what was rejected and why
- **Impact** — what this affects
- **Status** — Active / Superseded / Under Review

**Output:** Written to `DECISION-LOG.md` (or `--output <path>`).
