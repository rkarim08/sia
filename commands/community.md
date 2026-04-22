---
description: Inspect community structure at a given hierarchy level.
argument-hint: [level=1|2]
---

Invoke the `sia_community` MCP tool at the given level and summarise the partitioning.

### Usage

**When to invoke:**
- Orientation — "what are the major modules in this repo?"
- Before dispatching parallel agents — communities = independent-enough-to-parallelise
- Before a refactor — check module boundaries

**Inputs:** `$ARGUMENTS` — community hierarchy level (`1` for top-level clusters, `2` for sub-communities). Default is `1` when omitted.

**Worked example:**

```
$ /community 1
[community] Level 1 partition: 6 communities
  · api-gateway        (142 entities) — HTTP routing, middleware, rate-limit
  · orders             (88)           — checkout, charge, refund
  · docs-site          (61)           — marketing + API reference
  · auth               (54)           — session, token rotation
  · analytics          (39)           — event pipeline
  · infra              (27)           — deploy scripts, CI config
```

For entity-scoped community lookup (find the community of a specific entity), use the `sia_community` MCP tool directly with `entity_id`.
