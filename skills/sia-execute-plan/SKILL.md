---
name: sia-execute-plan
description: Executes implementation plans with SIA's staleness detection, per-task convention checks, and session resumption. Use when following a written implementation plan, resuming plan execution, or running through task checklists.
---

## Invariants

> These rules have NO exceptions. Executing a stale plan wastes more time than checking.
>
> 1. YOU MUST run the staleness check before executing any task. If a plan-referenced
>    file has been modified after the plan was written, STOP and alert the developer.
>    Do NOT proceed with a stale plan without explicit developer approval.
> 2. YOU MUST query SIA for conventions before each task. "The plan already says how
>    to do it" is not an excuse — conventions may have changed since the plan was written.
> 3. YOU MUST NOT invoke sia-finish until ALL plan tasks are complete and verified.
>    Partial completion is not completion.

## Red Flags — If You Think Any of These, STOP

| Thought | Why It's Wrong |
|---------|---------------|
| "The plan is recent, I can skip the staleness check" | Plans go stale faster than you expect. The check takes seconds; a stale-plan bug takes hours. |
| "The plan already specifies conventions" | Conventions evolve. The graph is current; the plan may not be. |
| "I'll finish the remaining tasks later" | sia-finish on a partial plan creates a misleading PR. Complete ALL tasks first. |
| "This task is simple enough to skip the convention query" | Simple tasks done wrong compound into complex problems. Always query. |

# SIA-Enhanced Plan Execution

Execute plans with staleness detection, per-task convention injection, and session resumption from SIA's knowledge graph.

## Usage

**When to invoke:**
- You have a written plan (from `/sia-plan` or hand-authored) to execute
- Resuming execution mid-plan after a session break
- Running through a task checklist that references files

**Inputs:** No arguments. Reads the plan file path from context (or asks).

**Worked example:** Plan `docs/plans/2026-04-10-rate-limit.md` referencing `src/api/middleware.ts`. Skill first runs `sia_by_file({ file_path: "src/api/middleware.ts" })` → entity last modified 2026-04-18 (AFTER the plan); warns "plan may be stale — middleware.ts has changed since the plan was written. Show diff?". After the user confirms the plan still applies, proceeds task-by-task, injecting per-task conventions via `sia_search`.

## Checklist

```
- [ ] Step 0: YOU MUST run staleness check — sia_by_file for each plan-referenced file. If any file changed since plan creation, STOP and alert. No exceptions.
- [ ] Step 1: Load and review plan, cross-reference against current graph state. Flag any contradictions.
- [ ] Step 2: For EACH task, YOU MUST query SIA for area conventions before starting. A task executed without this query may violate project standards.
- [ ] Step 3: Invoke sia-finish ONLY after ALL tasks are complete and verified. Partial completion is not completion.
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
