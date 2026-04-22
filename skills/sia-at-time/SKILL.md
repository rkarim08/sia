---
name: sia-at-time
description: Query the knowledge graph's state at a past point in time. Use when investigating regressions ("what did this look like before it broke?"), auditing historical decisions, or tracing how an entity evolved across sessions.
---

# SIA At-Time — Bi-Temporal Graph Query

Return the state of the knowledge graph as-of a given timestamp. Bi-temporal entities have `t_valid_from` / `t_valid_to`; this tool filters them so you only see facts that were valid at the requested point in time.

## When to call

- **Regression investigation (MANDATORY per CLAUDE.md).** Before proposing a fix, look at what the graph knew before the regression appeared. If a relevant Decision or Convention was invalidated between then and now, that is almost certainly your root cause.
- **Historical audit.** "What did we decide about auth on 2025-12-01?"
- **Diffing two points in time.** Call `sia_at_time` twice with different timestamps and compare the returned entities.

## Parameters

- `as_of` — ISO-8601 timestamp (`"2026-01-15T00:00:00Z"`) or a natural-language date that Sia will parse (`"before the billing refactor"`, `"3 months ago"`).
- `entity_types` (optional) — filter to specific node types, e.g. `["Decision", "Bug", "Solution"]`.
- `limit` (optional) — default 50.

## Typical output

Prose summary grouped by entity type, with each entity showing its state at the queried time (content, trust tier, valid-from/valid-to). Entities that were invalidated after `as_of` are marked clearly.

## Worked example

User: "The login endpoint started 500'ing two weeks ago — what did we know about auth before that?"

```
sia_at_time({
  as_of: "2026-04-07T00:00:00Z",
  entity_types: ["Decision", "Bug", "Solution", "Convention"],
  limit: 20
})
```

Then diff against the current state (`sia_search` with the same query) to find the drift window.

## Related

- CLAUDE.md Invariant 7: for regression tasks, `sia_at_time` is never optional.
- Playbook: `reference-regression.md` (load via `/sia-playbooks`).
