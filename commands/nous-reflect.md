---
description: Run a Nous self-monitor pass — drift breakdown and recommended action
argument-hint: [context]
---

Call the `nous_reflect` MCP tool. If an argument is provided, pass it as `context`:

```
nous_reflect({ context: "$ARGUMENTS" })
```

Present the response:

- Overall drift score and threshold comparison
- Per-preference alignment breakdown
- Recommended action (`continue`, `pause`, `escalate`)

If `recommendedAction` is `escalate`, surface the drift breakdown verbatim and wait for developer input before proceeding.
