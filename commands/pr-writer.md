---
description: Draft a pull-request description from captured Decisions + branch diff.
---

Dispatch the `@sia-pr-writer` agent. See [`agents/sia-pr-writer.md`](../agents/sia-pr-writer.md) — at a glance: ingests branch diff + Decisions/Bugs/Solutions captured on this branch and outputs a draft PR body ready for `gh pr create --body`.
