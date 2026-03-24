# Sia — New Developer Orientation Playbook

*Loaded by the base CLAUDE.md for architecture questions and new-developer orientation.*
*Follow these steps in order. They replace the condensed Step 1 in the base module.*

---

## New Developer Codebase Orientation

When a developer asks "how does this system work," "explain the architecture," or is
orienting to an unfamiliar codebase, the goal is a coherent narrative — not a list of
entity names. Sia's community detection has clustered the codebase into meaningful
modules with generated summaries; use those summaries to build understanding rather than
surfacing raw entity lists from `sia_search`.

**Step 0 — Graph readiness check**

Before calling `sia_community`, check whether the graph is large enough to have
community structure. If `sia_community` returns `global_unavailable: true` (graph
below 100 entities), skip Steps 1 and 2 entirely and go directly to Step 3. Tell
the developer: "The memory graph is still building — Sia improves with each session.
Here is what I can tell you from existing captured context:" then present the
Step 3 `sia_search` results as a narrative (Step 4 still applies — no raw entity
lists even in fallback mode).

If `sia_community` returns zero communities (graph is large enough but the topic
query matched nothing), do not stop. Continue to Step 3 (`sia_search`) and present
whatever decisions and concepts are available.

**Step 1 — System-wide structural view**

```
sia_community(query="architecture overview", level=2)
```

Level 2 gives a coarse architectural view: major subsystems, how they relate, and what
the overall design intent is. This is the starting point for any orientation.

**Step 2 — Subsystem drill-down**

```
sia_community(query=<developer's primary area>, level=1)
```

Level 1 gives module-level summaries. If the developer is focused on a specific area
(authentication, data pipeline, API layer), drill into the relevant subsystem here.

**Step 3 — Key decisions**

```
sia_search("architectural decisions constraints rationale",
  node_types=['Decision'],
  limit=10)
```

This surfaces the decisions that constrain future work — why certain patterns exist,
what was tried and rejected, and what the team has committed to. This is the context
that is hardest to recover from code alone.

**Step 4 — Present as a narrative**

Do not return a list of entity names. Synthesise the retrieved summaries and decisions
into a coherent explanation of the system: how the major modules relate, what the key
architectural decisions are, and what a developer needs to know before making changes.

A good orientation response answers: what does this system do, how is it structured,
what are the non-obvious constraints, and where should I start?

---

## Level Guide for `sia_community`

`level=2` — Coarse architectural overview. Appropriate for system-wide questions,
"explain the whole system," and first-day orientation.

`level=1` — Subsystem / module level. Appropriate for "explain the auth module" or
"how does the data pipeline work."

`level=0` — Fine-grained cluster view. Rarely needed by the agent; more useful from
the CLI when investigating a specific component. Do not use for orientation.

Never call `sia_community` as a fallback for a failed `sia_search` — they serve
different purposes. `sia_search` finds specific entities; `sia_community` explains
structure.

---

## Tool Budget for This Playbook

This playbook uses 3 tool calls: `sia_community(level=2)` (1) + `sia_community(level=1)`
(2) + `sia_search` (3). This is exactly the 3-tool limit. No `sia_expand` is needed for
orientation — community summaries already contain synthesised relationship context.
