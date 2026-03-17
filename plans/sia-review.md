# Sia — PR / Code Review Playbook

*Loaded by the base CLAUDE.md when `task_type = 'review'`.*
*Follow these steps in order. They replace the condensed Step 1 in the base module.*

---

## PR / Code Review

Code review with Sia is convention-first: retrieve the full set of project-specific
conventions before looking at a single line of code. Generic best-practice rules are
secondary. What matters is whether the change conforms to the patterns this team has
established in this project.

**Step 1 — Convention retrieval**

```
sia_search("conventions standards style patterns",
  task_type='review',
  node_types=['Convention'],
  limit=15)
```

Use `limit=15` here — this is one of the few contexts where maximum coverage matters
more than latency. You need the full convention set before evaluating the code.

**Step 2 — File-scoped retrieval**

For each file in the PR:

```
sia_by_file(file_path)
```

This surfaces decisions, patterns, and prior bug history for each changed file. A file
that has had recurring bugs around a specific pattern is worth scrutinising more closely.

**Step 3 — Evaluate each change**

Compare each change against the retrieved conventions and file-specific context. The
evaluation question is: does this change conform to the conventions the team has
established, and does it respect the decisions that constrain this file?

**Step 4 — Report violations by entity ID**

For each violation, cite the specific Convention entity that is breached. Do not
paraphrase the convention — reference it by ID so the developer can look it up:

> "Violation of Convention #conv-44: direct database query in service layer —
> all DB access must go through the Repository layer per this convention."

Never apply only general best-practice conventions. Project-specific conventions
stored in Sia take precedence and are the primary review criteria.

**Step 5 — Summarise**

Provide a summary that distinguishes: convention violations (must fix), Sia-unaware
patterns (worth noting), and items where no convention applies (developer discretion).

---

## Tool Budget for This Playbook

This playbook uses 1 + N tool calls: `sia_search` (1) + `sia_by_file` once per changed file (N calls, one each). The per-file `sia_by_file` calls are permitted by the review exception in Invariant 1 of the base module — they do not count against the 3-tool limit. This exception applies exclusively to `task_type='review'` sessions. Review is inherently multi-file and this budget is appropriate.
