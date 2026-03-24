---
name: sia-finish
description: Finishes development branches using SIA — generates semantic PR summaries from the knowledge graph, captures branch decisions, and updates the graph post-merge. Use when implementation is complete, all tests pass, and the branch is ready for merge or PR.
---

# SIA-Enhanced Branch Finishing

Finish a development branch with graph-powered semantic PR summaries and post-merge knowledge capture.

## Checklist

```
- [ ] Step 0: Query SIA for branch decisions/conventions/bugs
- [ ] Step 1: Verify tests pass (hard gate)
- [ ] Step 2-3: Determine base branch, present options (merge/PR/cleanup)
- [ ] Step 4: Create PR with Knowledge Summary section from graph entities
- [ ] Post-merge: Capture branch summary to graph, prune snapshots
```

## Workflow

### Step 0 — Branch Knowledge Summary (NEW)

Before running tests or creating a PR:

```
sia_search({ query: "decisions conventions <branch work area>", limit: 20 })
```

Collect all entities captured during this branch's lifetime. These become the PR's semantic summary.

### Step 1 — Verify Tests (same as standard)

Hard gate — tests must pass.

### Step 2-3 — Determine Base Branch + Present Options (same as standard)

### Step 4, Option 2 — Create PR (ENHANCED)

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
