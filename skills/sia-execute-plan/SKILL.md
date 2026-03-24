---
name: sia-execute-plan
description: Executes implementation plans with SIA's staleness detection, per-task convention checks, and session resumption. Use when following a written implementation plan, resuming plan execution, or running through task checklists.
---

# SIA-Enhanced Plan Execution

Execute plans with staleness detection, per-task convention injection, and session resumption from SIA's knowledge graph.

## Checklist

```
- [ ] Step 0: Staleness check — sia_by_file for each plan-referenced file
- [ ] Step 1: Load and review plan, cross-reference against graph
- [ ] Step 2: Per-task execution with convention queries
- [ ] Step 3: Invoke sia-finish for branch completion
```

## Workflow

### Step 0 — Staleness Check (NEW)

Before starting execution:

```
sia_search({ query: "<plan area>", limit: 10 })
```

For each file referenced in the plan, check if it was modified after the plan was written:

```
sia_by_file({ file_path: "<referenced_file>" })
```

If entities show recent modifications not accounted for in the plan, warn:

> "The plan references `src/auth/login.ts` which was modified after the plan was written. The plan may need updating."

### Step 1 — Load and Review Plan (enhanced)

Standard: read the plan file, identify concerns.

**Enhancement:** Cross-reference plan files against graph entities to identify any that have changed or have new conventions since the plan was written.

### Step 2 — Execute Tasks (ENHANCED)

For each task, before starting:

```
sia_search({ query: "conventions <task area>", node_types: ["Convention"], limit: 5 })
sia_by_file({ file_path: "<task target file>" })
```

Include relevant conventions in the task context so the implementation follows project patterns.

After each task, the session resume system (Phase J) captures progress automatically.

### Step 3 — Complete Development (same as standard)

Invoke sia-finish for branch completion.

## Key Principle

**Plans go stale. The graph knows what changed.** Always verify plan assumptions against current graph state before executing.
