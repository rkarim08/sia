---
name: sia-debug-workflow
description: Debugs systematically using SIA's temporal knowledge graph — traces root cause through time, surfaces known bugs, and finds past solutions. Use when encountering bugs, errors, test failures, or unexpected behavior.
---

## Invariants

> These rules have No exceptions. A debug session that violates them is incomplete.
>
> 1. YOU MUST query `sia_search` for known bugs BEFORE investigating. "I already
>    know the cause" is the #1 reason developers re-debug solved problems.
> 2. YOU MUST capture both a Bug entity AND a Solution entity after fixing.
>    A fix without graph capture is an incomplete session. STOP and capture
>    before moving on.
> 3. If a Bug+Solution pair already exists in the graph, STOP investigating
>    and apply the known fix. Do not re-derive what's already known.

## Red Flags — If You Think Any of These, STOP

| Thought | Why It's Wrong |
|---------|---------------|
| "I already know the root cause" | You know A root cause. The graph may know THE root cause — and it may be different. Query first. |
| "This is a quick fix, I don't need the temporal query" | Quick fixes that skip temporal investigation are how regressions get re-introduced. |
| "The bug is obvious from the stack trace" | Stack traces show symptoms, not causes. The graph shows causal history. |
| "I'll capture the bug after I fix it" | If you forget (and you will), the next developer re-debugs from scratch. Capture NOW. |
| "This bug isn't important enough to record" | Every bug is important enough. Future-you will thank present-you. |

# SIA-Enhanced Systematic Debugging

Debug methodically with SIA's temporal knowledge graph — adds temporal investigation ("when did it break?"), known bug history, and cross-session memory to standard debugging.

## Usage

**When to invoke:**
- Bug reproduced, stack trace in hand, before investigating
- Test failure or regression you don't immediately recognise
- "It used to work" — always routes here (temporal investigation)
- Error message appears to match a pattern you've seen before

**Inputs:** No arguments. The skill drives `sia_search` / `sia_at_time` / `sia_by_file` MCP tools against the active repo.

**Worked example:** User reports `TypeError: Cannot read property 'userId' of undefined in auth/session.ts`. Phase 1 runs `sia_search({ query: "userId undefined session", node_types: ["Bug", "Solution"] })` and returns a matching Bug + Solution pair from 6 weeks ago — the session object needed `requireAuth` middleware. Apply the known fix (5 minutes) instead of re-deriving it (2 hours).

## Checklist

```
- [ ] Phase 1: YOU MUST query SIA for known bugs/solutions BEFORE investigating. If a match exists, apply it — do not re-derive. Run sia_at_time. Check affected files.
- [ ] Phase 2: Expand dependency chain with sia_expand. Find working patterns in the same community. Do NOT skip this — the bug may originate upstream.
- [ ] Phase 3: Form ONE hypothesis, test minimally, verify. Do not shotgun multiple changes.
- [ ] Phase 4: Fix, then YOU MUST capture both Bug AND Solution to graph. A debug session without sia_note calls for both is INCOMPLETE.
```

## 4-Phase Workflow

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

**For detailed temporal investigation guidance:** See [temporal-investigation.md](temporal-investigation.md)

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

**For detailed causal chain analysis:** See [root-cause-tracing.md](root-cause-tracing.md)

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

**For test pollution bisection:** Run `skills/sia-debug-workflow/scripts/find-polluter.sh`

## Key Principle

**Time is your best debugging tool.** `sia_at_time` lets you ask "what was true before this broke?" — that's usually the fastest path to root cause.
