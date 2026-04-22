---
description: Query the graph's state at a past point in time.
argument-hint: <ISO-8601 timestamp or natural-language date>
---

Invoke the `sia_at_time` MCP tool with the given timestamp and present the graph state at that point.

### Usage

**When to invoke:**
- "What did we know before this broke?" — regression root-cause investigation
- Auditing graph state at a release tag or incident time
- Comparing current knowledge against a historical snapshot

**Inputs:** `$ARGUMENTS` — ISO-8601 timestamp (`2026-03-15T12:00:00Z`) or a natural-language date (`"2 weeks ago"`, `"last Friday"`). Optional `entity_types` filter inside the MCP call.

**Worked example:**

```
$ /at-time 2026-03-15T00:00:00Z
[at-time] Graph state as of 2026-03-15T00:00:00Z
  · Active entities: 2,198 (vs 2,431 today)
  · Active conflicts: 4 (vs 1 today — 3 resolved since)
  · Last Decision before cutoff: "Use Redis for rate limiting" (2026-02-14)
```

Always called by the regression playbook — see `reference-regression.md` for the full flow.
