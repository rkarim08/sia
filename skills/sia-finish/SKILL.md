---
name: sia-finish
description: Finishes development branches using SIA — generates semantic PR summaries from the knowledge graph, captures branch decisions, and updates the graph post-merge. Use when implementation is complete, all tests pass, and the branch is ready for merge or PR.
---

## Invariants

> These rules have NO exceptions. A PR without knowledge context is a missed opportunity.
>
> 1. YOU MUST query SIA for branch decisions before creating the PR. "I remember
>    what I did" is not sufficient — the graph contains entities from sessions
>    you may not recall.
> 2. NEVER create a PR without a Knowledge Captured section. If the branch truly
>    captured zero entities, state explicitly: "No decisions, conventions, or bugs
>    were captured during this branch." An empty omission is not acceptable.
> 3. YOU MUST call `sia_note` after merge to capture the branch summary.
>    A merge without post-merge capture is incomplete.

## Red Flags — If You Think Any of These, STOP

| Thought | Why It's Wrong |
|---------|---------------|
| "This PR is too small for a knowledge section" | Small PRs with undocumented decisions are how institutional knowledge is lost. |
| "The PR description already explains everything" | PR descriptions are not queryable by future sessions. The graph is. Capture anyway. |
| "I'll add the knowledge section later" | You won't. Do it now. |
| "Tests passed, so I can skip the SIA query" | Tests verify correctness, not knowledge. The SIA query surfaces decisions worth documenting. |
| "No decisions were made on this branch" | Every branch makes decisions — even "keep the existing approach" is a decision worth noting. |

# SIA-Enhanced Branch Finishing

Finish a development branch with graph-powered semantic PR summaries and post-merge knowledge capture.

## Usage

**When to invoke:**
- Feature/fix implementation is done and tests pass
- User asks to "wrap up", "open a PR", or "finish the branch"
- After the last commit on a dev branch, before merge

**Inputs:** No arguments. Reads the current branch + SIA entities captured during the branch's lifetime.

**Worked example:** On branch `feature/add-rate-limiting` with 4 commits. Skill runs `sia_search({ query: "rate limiting", limit: 20 })` → finds 2 Decisions and 1 Convention captured this branch; generates a PR body with `## Knowledge Captured` listing them; after merge runs `sia_note({ kind: "Decision", name: "Merged: add rate limiting" })` so future sessions see the branch-level summary.

## Checklist

```
- [ ] Step 0: YOU MUST query SIA for branch decisions/conventions/bugs before creating any PR. No exceptions.
- [ ] Step 1: Hard gate — tests MUST pass. A PR with failing tests is not ready. Period.
- [ ] Steps 2-3: Determine base branch, present options (merge/PR/cleanup)
- [ ] Step 4: Create PR with Knowledge Summary section from graph entities. NEVER omit this section.
- [ ] Post-merge: YOU MUST capture branch summary to graph via sia_note. A merge without this call is incomplete.
```

## Workflow

### Step 0 — Branch Knowledge Summary (NEW)

Before running tests or creating a PR:

```
sia_search({ query: "decisions conventions <branch work area>", limit: 20 })
```

Collect all entities captured during this branch's lifetime. These become the PR's semantic summary.

### Step 1 — Verify Tests (same as standard)

Always invoke `/sia-verify-before-completion` first.

Hard gate — tests must pass.

### Step 2-3 — Determine Base Branch + Present Options (same as standard)

### Step 4, Option 2 — Create PR (ENHANCED)

**For the full PR template:** See [pr-summary-template.md](pr-summary-template.md)

When creating a PR, include a **Knowledge Summary** section built from graph entities:

```markdown
## Summary
- [Standard git diff summary]

## Knowledge Captured
### Decisions Made
- [Decision entities created during this branch]

### Conventions Established
- [Convention entities]

### Bugs Found & Fixed
- [Bug + Solution entity pairs]
```

This gives reviewers semantic context — not just what changed, but WHY.

### Post-Merge — Knowledge Capture (NEW)

After merge:

```
sia_note({ kind: "Decision", name: "Merged: <branch purpose>", content: "<summary of all work done on this branch>" })
```

If branch snapshots exist (Phase D.5), trigger cleanup:

```
sia_snapshot_prune({ branch_names: ["<merged_branch>"] })
```

## Key Principle

**PR descriptions should tell the story, not just list the diff.** SIA knows the decisions, conventions, and bugs from this branch — use them.
