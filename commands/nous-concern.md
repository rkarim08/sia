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
