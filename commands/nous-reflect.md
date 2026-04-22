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

### Worked example

```
$ /nous-reflect "about to approve a big refactor PR"
[nous] overall drift: 0.78 (above 0.70 warning)
[nous] per-preference alignment:
  · "YAGNI ruthlessly" — 0.91 (aligned)
  · "Verify before claim" — 0.44 (drifting — 2 recent "looks good" without command output)
  · "Never mock DB in tests" — 0.88 (aligned)
[nous] recommendedAction: escalate
```

Surface the breakdown to the developer before continuing with the PR decision.
