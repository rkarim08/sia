---
name: sia-verify-before-completion
description: |
  Use when about to claim work is complete, fixed, or passing, before
  committing or creating PRs — requires running verification commands
  and confirming output before making any success claims; evidence
  before assertions always. Runs `sia-verify` + `sia-test` against
  the current area and surfaces past failure-modes for that area from
  the graph. Required reading before invoking `sia-finish`.
---

# Verify Before Completion

A "done" claim without evidence is a failure. This skill enforces the
**verify-then-claim** discipline: you run verification commands, read the
output, confirm it supports the claim, and only then state that work is
complete. Sia adds a past-failure lookup so you do not rediscover known
regressions the hard way.

## When to use

Invoke this skill at three pre-action triggers:

1. **Pre-commit** — before `git commit`, verify the working tree passes
   the checks the area requires (tests, typecheck, lint).
2. **Pre-PR** — before opening a PR or invoking `/sia-finish`, verify
   the branch is green end-to-end and that known failure-modes for the
   touched area are covered.
3. **Pre-deploy** — before merging to a protected branch or triggering
   a release pipeline, verify integration/e2e gates and confirm the
   deploy target matches what was tested.

## Required verification checklist

```
- [ ] Run the area's verification commands (`sia-verify`, `sia-test`,
      and any area-specific gates surfaced by Sia).
- [ ] READ the full output — do not skim. Scroll to the summary lines
      and check exit codes. Silent failures hide in the middle.
- [ ] Query the graph for past failure-modes in the same area:
      `sia_search({ query: "<area> failure regression", node_types: ["Bug"], limit: 10 })`
      — if a prior Bug entity exists, confirm its regression surface
      is covered by the run you just read.
- [ ] Confirm no open Concern (`nous_concern`) blocks the completion
      claim. An open Concern in the same area is a hold signal.
- [ ] State the evidence alongside the claim: "<check X> passed with
      output <summary>" — not just "done".
```

## Workflow

### Step 0 — Past-failure lookup

Before running commands, query the graph for the area's known failure-modes:

```
sia_search({ query: "<area> failure regression bug", node_types: ["Bug"], limit: 10 })
sia_search({ query: "verification requirements <area>", node_types: ["Convention"], limit: 5 })
```

Any `Bug` entity surfaced becomes an explicit verification target — the
regression it describes MUST be covered by the run you are about to do.

### Step 1 — Run the verification commands

At minimum: `sia-verify` + `sia-test` against the current area. Add any
area-specific gate surfaced in Step 0 (integration tests, typecheck,
lint, schema-diff, etc.).

### Step 2 — Read the output

Read the full output, not just the last line. Check exit codes. If a
test was skipped, ask why. If a suite short-circuited, ask why.

### Step 3 — Check Concerns

```
nous_concern()
```

If an open Concern names the area you are claiming complete, do NOT
claim completion. Surface the Concern and resolve or defer it
explicitly.

### Step 4 — Make the claim with evidence

Pair every completion claim with the command output that supports it.
"Tests pass" alone is not evidence — the command line and the summary
line are.

## Never claim done without

- **Passing tests that weren't actually run.** Re-running is cheap.
  Mental testing misses ~70% of regressions.
- **Assumptions instead of observations.** "It should work" is not
  evidence. The verification command output is.
- **Silent fallbacks.** A skipped suite, a pre-existing failure
  ignored, a warning downgraded to "known" — each one voids the
  completion claim until investigated.

## Relationship to other skills

- `/sia-verify` — the area-aware verification gate. This skill invokes it.
- `/sia-test` — the test-runner gate. This skill invokes it.
- `/sia-finish` — finalises a branch. Always invoke this skill **before**
  `/sia-finish`; a finish without prior verification is incomplete.

## Key principle

Evidence before assertions, always. If you cannot cite the command
output that proves the claim, the claim is not verified yet.
