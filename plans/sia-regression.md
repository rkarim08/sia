# Sia — Regression Investigation Playbook

*Loaded by the base CLAUDE.md when `task_type = 'bug-fix'` (regression signal detected).*
*Follow these steps in order. They replace the condensed Step 1 in the base module.*

---

## Regression Investigation

A regression is any situation where something worked before and is now broken. The key
capability that distinguishes Sia's regression support from generic memory retrieval is
`sia_at_time`: it lets you query the graph as it existed at a point in the past, surfacing
exactly what facts changed between then and now.

**Step 1 — Initial search (current state)**

```
sia_search(symptom_description,
  task_type='bug-fix',
  node_types=['Bug', 'Solution', 'Decision'],
  limit=10)
```

Scan results for entities matching the symptom, affected files, or known related
components. Look for a prior instance of this bug, a Decision that was recently changed,
or a Solution that should have prevented this.

**Step 2 — Causal chain traversal (conditional)**

If a relevant entity is found in Step 1, call:

```
sia_expand(entity_id, depth=1, edge_types=['supersedes', 'caused_by', 'solves'])
```

This surfaces what superseded the old fact, what caused the bug, and what solutions were
previously applied. This call is optional — use it only when the Step 1 result points to
a likely causal chain. It counts against the 2-call sia_expand session budget.

**Step 3 — Temporal investigation (MANDATORY — never skip)**

```
// Initial call — use the default limit
sia_at_time(
  as_of='<estimated date regression began>',
  tags=[<relevant tags>],
  limit=20
)
```

Important: `limit` applies to **both** `entities[]` and `invalidated_entities[]` simultaneously. Bumping `limit` to 50 on a re-call returns 50 current entities alongside 50 invalidated entities — the extra current entities are usually irrelevant to regression work and add response payload that may hit the `maxResponseTokens` cap. Prefer narrowed re-calls over blindly increasing `limit`.

If the initial call returns `invalidated_count > invalidated_entities.length` (result is truncated), make a **narrowed follow-up** targeting causally relevant entity types rather than raising `limit` alone:

```
// Truncation follow-up — narrow by type to reduce current-entity noise
sia_at_time(
  as_of='<same date>',
  entity_types=['Decision', 'Solution', 'Bug'],  // causally relevant types
  tags=[<relevant tags>],
  limit=50
)
```

Without this call, the temporal investigation capability is completely unused. `sia_at_time`
returns two arrays — read them in this order:

`invalidated_entities[]` is the primary diagnostic signal. These are facts that ENDED on
or before `as_of`. Each entry's `t_valid_until` is exactly when that fact stopped being
true. **Entries with `t_valid_until` closest to `as_of` are the most temporally
relevant** — they represent what changed most recently before the regression and are
therefore the highest-priority root cause candidates. The array is sorted by
`t_valid_until DESC` so the most relevant entries appear first.

`entities[]` contains facts still valid at `as_of`. Compare these against the current
`sia_search` output to see what has changed since that date.

If `invalidated_count > invalidated_entities.length`, the result is truncated. Make
additional narrowed calls using `entity_types` or `tags` to retrieve the remaining
entries. Do not treat a truncated result as the complete picture.

**Step 4 — Explain the delta**

Present the findings to the developer with specific entity citations. The answer to
"what caused the regression" should be grounded in one or more specific invalidated
entities, not general speculation.

**Step 5 — Flag if applicable**

If flagging is enabled (`enableFlagging: true`) and the root cause is non-obvious:
`sia_flag("Root cause: [description]")`. If flagging is disabled, skip this step.

---

## Edge Types for Regression Investigation

When calling `sia_expand` during regression work, these edge types are most diagnostic:

`supersedes` — what replaced the old Decision or Solution
`caused_by` — what entity directly caused this Bug
`solves` — what Solution was supposed to address this Bug
`invalidates` — what action marked the old fact as no longer true

Use `edge_types=['supersedes','caused_by','solves']` as the default filter for regression
traversal. This keeps the neighborhood focused on causal relationships rather than
structural dependencies, which tend to be less diagnostic for regression work.

---

## Tool Budget for This Playbook

This playbook uses up to 4 tool calls, which is the permitted exception to the 3-tool
invariant. The sequence is: `sia_search` (1) + conditional `sia_expand` (2) +
`sia_at_time` (3) + one additional narrowed `sia_at_time` if truncated (4). If no
causal entity is found in Step 1, skip `sia_expand` and stay within 3 calls.
