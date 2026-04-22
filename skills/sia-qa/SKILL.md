---
name: sia-qa
description: Use before release, after test-suite failures, or at sprint close. `--mode coverage` (gaps), `--mode flaky` (recurring failures), or `--mode full` (aggregate dossier).
---

# SIA QA

QA-focused reporting from the knowledge graph. One skill, three modes.

## Usage

Select the mode with `--mode`:

- `--mode coverage` — coverage-gap analysis (bugs without tests, high-churn/low-coverage modules)
- `--mode flaky` — flaky test pattern miner (recurring Bug entities on test files)
- `--mode full` — risk-based QA report (changes since date, risk, test priorities, coverage gaps)

---

## `--mode coverage` — Coverage-gap analysis

Analyzes test coverage gaps using SIA's knowledge graph — finds buggy areas without tests and high-churn modules with low coverage. Use when planning test improvements or before releases.

**When to invoke:**
- Planning test-improvement sprint
- Pre-release coverage audit
- User asks "where are we under-tested?"

**Inputs:** No arguments. Optionally scope via `--module <path>`.

**Worked example:**

```
$ /sia-qa --mode coverage --module src/orders
[coverage] 14 CodeEntities · 3 Bug entities · 1 dedicated test file
[coverage] GAP: src/orders/refund.ts — 2 Bugs captured, no test entity
[coverage] GAP: src/orders/checkout.ts — 1 Bug, partial test coverage
```

### How It Works

SIA cross-references:
- **Code entities** (functions, classes) from AST indexing
- **Bug entities** from captured failures
- **Test files** detected in the graph

Areas with bugs but no corresponding test entities = coverage gaps.

### Direct MCP queries

Ask the sia-qa-analyst agent or run:

```
sia_search({ query: "code entities <module>", node_types: ["CodeEntity"], limit: 50 })
sia_search({ query: "bugs <module>", node_types: ["Bug"], limit: 20 })
```

Cross-reference to find gaps.

---

## `--mode flaky` — Flaky test pattern miner

Tracks flaky test patterns using SIA — finds tests that fail intermittently and recurring test failures. Use when investigating test instability or prioritizing test reliability work.

Identify flaky tests by mining SIA's bug history for patterns:
- Tests that appear as Bug entities multiple times (recurring failures)
- Tests where Bug → Solution → Bug again (fixed then broke again)
- Areas with high Bug creation + invalidation churn

**When to invoke:**
- Triaging a CI that fails intermittently
- "Which tests should we quarantine?" decisions
- Post-release retro on test reliability

**Inputs:** No arguments.

**Worked example:**

```
$ /sia-qa --mode flaky
[flaky] Top candidates (re-surfaced Bug entities):
  · test/api/rate-limit.spec.ts → 4 Bugs across 3 months (fix → regression → fix → ...)
  · test/orders/checkout.spec.ts → 2 Bugs, same assertion
[flaky] Suggestion: quarantine rate-limit.spec.ts and re-investigate root cause.
```

### How It Works

```
sia_search({ query: "test failure flaky intermittent", node_types: ["Bug"], limit: 30 })
sia_at_time({ as_of: "<one_month_ago>", entity_types: ["Bug"] })
```

Compare Bug entities over time — tests that repeatedly fail and get fixed are flaky candidates.

---

## `--mode full` — Risk-based QA report

Generates a QA-focused report from SIA — changes since last test cycle, risky areas, and recommended test priorities. Use before QA cycles, for test planning, or risk-based testing decisions.

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

### What It Shows

1. **Changes since date** — decisions, code changes, new features grouped by module
2. **Risk assessment** — bug density + change velocity per area
3. **Bug activity** — bugs found, fixed, and still open
4. **Test recommendations** — what to test first, specific test cases from bug history
5. **Coverage gaps** — areas with code changes but no corresponding test changes

### Output

Written to `QA-REPORT.md` in the project root (or `--output <path>`).
