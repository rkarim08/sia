---
name: sia-qa-flaky
description: Tracks flaky test patterns using SIA — finds tests that fail intermittently and recurring test failures. Use when investigating test instability or prioritizing test reliability work.
---

# SIA Flaky Test Tracker

Identify flaky tests by mining SIA's bug history for patterns:
- Tests that appear as Bug entities multiple times (recurring failures)
- Tests where Bug → Solution → Bug again (fixed then broke again)
- Areas with high Bug creation + invalidation churn

## Usage

**When to invoke:**
- Triaging a CI that fails intermittently
- "Which tests should we quarantine?" decisions
- Post-release retro on test reliability

**Inputs:** No arguments.

**Worked example:**

```
$ /sia-qa-flaky
[flaky] Top candidates (re-surfaced Bug entities):
  · test/api/rate-limit.spec.ts → 4 Bugs across 3 months (fix → regression → fix → ...)
  · test/orders/checkout.spec.ts → 2 Bugs, same assertion
[flaky] Suggestion: quarantine rate-limit.spec.ts and re-investigate root cause.
```

## How It Works

```
sia_search({ query: "test failure flaky intermittent", node_types: ["Bug"], limit: 30 })
sia_at_time({ as_of: "<one_month_ago>", entity_types: ["Bug"] })
```

Compare Bug entities over time — tests that repeatedly fail and get fixed are flaky candidates.
