# Sia — Feature Implementation Playbook

*Loaded by the base CLAUDE.md when `task_type = 'feature'`.*
*Follow these steps in order. They replace the condensed Step 1 in the base module.*

---

## Feature Implementation

Feature work benefits from Sia in two ways: understanding the architectural context
before writing code (avoiding decisions that conflict with past choices), and discovering
conventions that constrain implementation (patterns the team has established that must
be followed). Both types of retrieval happen before a single line of code is written.

**Step 1 — Structural orientation**

```
sia_community(feature_domain, level=1)
```

Get module-level structural orientation before touching any files. This tells you which
existing modules are involved, how they relate, and what architectural patterns govern
this area. For cross-cutting features that span multiple modules, call `sia_community`
at level=2 first for a system-wide view, then level=1 for the relevant subsystem.

**Step 2 — Decision and convention retrieval**

```
sia_search(feature_topic,
  task_type='feature',
  node_types=['Decision', 'Convention'],
  limit=10)
```

This surfaces: architectural decisions that constrain how the feature must be built,
conventions the implementation must follow, and prior work in this area that you should
be consistent with. Pay particular attention to Convention entities — see Step 5.

**Step 3 — File-scoped retrieval**

```
sia_by_file(file_path)   // for each file to be created or modified
```

For files in a linked repository within the workspace, use
`sia_by_file(file_path, workspace=true)` — this surfaces cross-repo edges for that
specific file. Call `sia_by_file` before `sia_search` when the file is the primary
anchor; call after when the topic is the primary anchor.

**Step 4 — Optional relationship traversal**

If a returned Decision entity references related entities you need to understand before
implementing, call:

```
sia_expand(entity_id, depth=1)
```

Use only when the relationship is directly decision-relevant, not out of curiosity. This
consumes one of the two allowed `sia_expand` calls for the session.

**Step 5 — Convention scanning (critical)**

Before writing any code, scan all returned Convention entities carefully. Conventions
are hard constraints, not style suggestions. If a Convention says "all errors must extend
`AppBaseError`," that is a requirement, not a preference. Violations are bugs.

State the applicable conventions before you start implementing:
"Convention #conv-44 requires all DB access to go through the Repository layer — I'll
route this through `UserRepository` rather than querying directly."

**Step 6 — Cross-repo workspace search (if applicable)**

If the feature spans linked repositories, also call:

```
sia_search(api_topic, workspace=true)
```

This surfaces API contracts, shared types, and cross-service calls that the feature
must conform to. Only use `workspace: true` when the task genuinely crosses repo
boundaries — it adds 400ms latency and cross-repo noise for single-repo tasks.

**Step 7 — Implement**

Implement following all retrieved conventions and prior decisions. Cite the relevant
entities in comments where the constraint is non-obvious.

**Step 8 — Flag if applicable**

If flagging is enabled (`enableFlagging: true`) and you made an architectural decision
during implementation: `sia_flag(decision_summary)`. If flagging is disabled, skip
this step — the session-end capture will record the decision automatically, though
with lower precision.

---

## Tool Budget for This Playbook

This playbook uses 3 tool calls in the standard case: `sia_community` (1) + `sia_search` (2) + `sia_by_file` (3). The optional Step 4 `sia_expand` call pushes the count to 4, which exceeds the base module's 3-tool limit. This is permitted only when genuinely necessary — it consumes one of the two allowed `sia_expand` calls for the session. It does NOT consume a regression-exception slot. The 4-call regression exception applies exclusively to `task_type='bug-fix'` sessions. For straightforward features where `sia_expand` is not needed, stay within 3 calls.
