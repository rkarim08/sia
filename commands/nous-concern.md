---
description: Surface open Nous Concern nodes as prioritised insights
argument-hint: [context]
---

Call the `nous_concern` MCP tool. If an argument is provided, pass it as `context`:

```
nous_concern({ context: "$ARGUMENTS" })
```

Use this before responding to open-ended "what should I look at?" or "what am I missing?" questions. Concerns are filtered against active Preference nodes so the results are weighted by what the developer currently cares about.

Present the top Concerns with their priority and summary. Suggest one or two as candidates to act on.

### Worked example

User: "what should I be watching out for in the payments module?"

```
$ /nous-concern "payments module"
[concern] 3 open Concerns, weighted by active preferences:
  1. [HIGH] "Idempotency key rotation missed on refund path" — Bug from 2 sprints ago, no regression test captured
  2. [MED]  "Charge retry logic duplicates effects under clock skew" — Decision superseded but not invalidated
  3. [LOW]  "Stripe webhook validation uses deprecated signature v1"
```

Suggest acting on #1 first — it's a captured Bug without a regression test, which matches the "Verify before claim" active preference.
