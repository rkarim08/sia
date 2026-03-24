---
name: sia-debug-workflow
description: Systematic debugging enhanced with SIA's temporal knowledge graph — traces root cause through time, surfaces known bugs in the area, and finds past solutions. Uses sia_at_time to pinpoint when things broke.
---

# SIA-Enhanced Systematic Debugging

Debug methodically with SIA's temporal knowledge graph. This improves upon standard systematic debugging by adding temporal investigation ("when did it break?"), known bug history, and cross-session debugging memory.

## What SIA Adds

Standard debugging explores the current code state. SIA-enhanced debugging also:
- **Queries temporal history** — `sia_at_time` shows the graph state before the bug existed
- **Surfaces known bugs** — checks if this bug (or similar) was seen before
- **Recalls past solutions** — finds solutions that fixed related bugs
- **Maps causal chains** — traces dependencies to find upstream root causes
- **Remembers across sessions** — a bug investigated yesterday has context today

## Enhanced 4-Phase Workflow

### Phase 1 — Root Cause Investigation (ENHANCED)

**Standard steps:** Read errors, reproduce consistently, check recent changes.

**SIA enhancement — add BEFORE standard investigation:**

```
sia_search({ query: "<error message or symptom>", task_type: "bug-fix", node_types: ["Bug", "Solution"], limit: 10 })
```

If a matching Bug+Solution pair exists → **stop investigating and apply the known fix.** Don't re-debug what's already been solved.

If no match, use temporal investigation:

```
sia_at_time({ as_of: "<time_before_bug>", entity_types: ["Decision", "Bug", "Solution"] })
```

Compare the graph state before vs after the bug appeared. What decisions or changes coincide with the bug's introduction?

For each affected file:

```
sia_by_file({ file_path: "<broken_file>" })
```

Check for known issues, recent changes, and related entities.

### Phase 2 — Pattern Analysis (ENHANCED)

**Standard steps:** Find working examples, compare, identify differences.

**SIA enhancement:**

```
sia_expand({ entity_id: "<broken_entity>", depth: 2, edge_types: ["calls", "imports", "depends_on"] })
```

Map the full dependency chain. The bug may originate upstream — SIA's edges show what calls/imports the broken code.

```
sia_community({ entity_id: "<broken_entity>" })
```

Find structurally similar code in the same community that IS working. Compare the broken version against the working pattern.

### Phase 3 — Hypothesis and Testing (same as standard)

Form a single hypothesis, test minimally, verify. No SIA changes needed here — this phase is about focused experimentation.

### Phase 4 — Implementation + Capture (ENHANCED)

**Standard steps:** Create failing test, implement fix, verify.

**SIA enhancement — after fixing:**

```
sia_note({ kind: "Bug", name: "<root_cause>", content: "<what was wrong, affected files, how it manifested>" })
sia_note({ kind: "Solution", name: "<fix_description>", content: "<what was done, why it works>", relates_to: ["<bug_entity_id>"] })
```

**Always capture both the Bug and the Solution.** If 3+ fixes fail (standard threshold for questioning architecture), also query:

```
sia_search({ query: "<module> recurring bugs failures", node_types: ["Bug"], limit: 20 })
```

Check if this is a problem area with a history of bugs. If so, surface the pattern to the developer — this may need a design change, not another patch.

## Key Principle

**Time is your best debugging tool.** `sia_at_time` lets you ask "what was true before this broke?" — that's usually the fastest path to root cause.
