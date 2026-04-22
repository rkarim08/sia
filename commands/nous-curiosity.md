---
description: Explore under-retrieved, high-trust graph knowledge — writes Concern nodes
argument-hint: [topic]
---

Call the `nous_curiosity` MCP tool. If an argument is provided, pass it as the `topic`:

```
nous_curiosity({ topic: "$ARGUMENTS" })
```

Curiosity explores the graph for high-trust entities that have never been retrieved and writes them as open Concern nodes. Use when a task completes with remaining capacity or a knowledge gap becomes visible.

Summarise what was discovered and which Concerns were created.

### Worked example

```
$ /nous-curiosity "auth module"
[curiosity] scanned 142 high-trust auth entities
[curiosity] 3 have never been retrieved across all sessions:
  · Decision: "Session tokens must rotate on privilege elevation"
  · Convention: "All auth logs tagged with trace_id"
  · Bug: "Fixed CSRF bypass — regression test in test/auth/csrf.spec.ts"
[curiosity] Created 3 Concern nodes (priority: medium, low, low).
```
