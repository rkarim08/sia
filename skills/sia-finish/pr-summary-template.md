# Semantic PR Summary Template

Use this template when creating PRs via sia-finish. The "Knowledge Captured" section is built from SIA graph entities collected during the branch's lifetime.

## Template

```markdown
## Summary
<Standard git diff summary — what changed, why>

## Knowledge Captured

### Decisions Made
<For each Decision entity captured during this branch:>
- **{decision.name}** — {decision.content} (rationale: {why})

### Conventions Established
<For each Convention entity:>
- **{convention.name}** — {convention.content}

### Bugs Found & Fixed
<For each Bug + Solution pair:>
- **{bug.name}** → Fixed by: {solution.name}
  - Root cause: {bug.content}
  - Fix: {solution.content}

### Architecture Changes
<If any community structure or module boundaries changed:>
- {description of structural change}
```

## How to Populate

### Step 1 — Query branch entities

```
sia_search({ query: "decisions conventions <branch work area>", limit: 20 })
```

### Step 2 — Filter to branch lifetime

Only include entities captured AFTER the branch was created. Check `t_valid_from` against the branch creation date (from `git log --oneline --reverse HEAD...main | head -1`).

### Step 3 — Pair Bugs with Solutions

For each Bug entity, check if a Solution entity references it (via `relates_to` or matching name). Present them as pairs.

### Step 4 — Omit empty sections

If no Conventions were established, omit that section. Don't include empty headers.

## Why This Matters

Standard PR descriptions list the diff — WHAT changed. Graph-powered summaries add WHY: the decisions that drove the changes, the bugs that motivated fixes, the conventions that were established. Reviewers get semantic context, not just code context.
