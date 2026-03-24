---
name: sia-qa-flaky
description: Track flaky test patterns using SIA — finds tests that appear as both Bug and Solution entities (failed then passed), recurring test failures, and intermittent issues
---

# SIA Flaky Test Tracker

Identify flaky tests by mining SIA's bug history for patterns:
- Tests that appear as Bug entities multiple times (recurring failures)
- Tests where Bug → Solution → Bug again (fixed then broke again)
- Areas with high Bug creation + invalidation churn

## How It Works

```
sia_search({ query: "test failure flaky intermittent", node_types: ["Bug"], limit: 30 })
sia_at_time({ as_of: "<one_month_ago>", entity_types: ["Bug"] })
```

Compare Bug entities over time — tests that repeatedly fail and get fixed are flaky candidates.
