---
name: sia-pm-decision-log
description: Use before quarterly planning, before a new teammate onboards, or when a stakeholder asks 'why did we choose X'.
---

# SIA Decision Log

Generate a formal decision log from the knowledge graph — useful for stakeholder reviews, audits, and project governance.

## Usage

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
