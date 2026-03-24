---
name: sia-verify
description: Verifies work completeness using SIA's knowledge of area-specific requirements, past verification failures, and known gotchas. Use when about to claim work is done, before committing, or before creating PRs.
---

## Invariants

> These rules have No exceptions. A "done" claim without evidence is a FAILURE.
>
> 1. YOU MUST run a verification command and read its FULL output before claiming
>    ANY work is done. "I'm confident it works" is NEVER sufficient.
> 2. If SIA surfaces area-specific verification requirements, you MUST verify
>    EACH ONE explicitly. Running only `bun run test` is not enough if the area
>    also requires typecheck, lint, or integration tests.
> 3. A claim of completion without a corresponding command output in the
>    conversation is a FAILED verification. There is no such thing as
>    "obviously correct."

## Red Flags — If You Think Any of These, STOP

| Thought | Why It's Wrong |
|---------|---------------|
| "The change is too small to verify" | Small changes cause the largest regressions. Verify. |
| "I already tested this mentally" | Mental testing catches ~30% of issues. Run the command. |
| "The CI will catch any problems" | CI runs after you commit. Catch it NOW. |
| "I ran a similar test earlier" | Earlier tests tested earlier code. This is different code. Run again. |
| "The tests are flaky, so a failure doesn't mean anything" | Re-run. If it fails twice, investigate. Do NOT claim success on a failing test. |
| "Just this once, I'll skip the SIA query" | The SIA query is how you discover area-specific requirements you don't know about. Never skip. |

# SIA-Enhanced Verification

Verify work is truly complete — queries SIA for area-specific requirements, past verification failures, and known gotchas before running checks. Evidence before assertions.

## Checklist

```
- [ ] Step 0: YOU MUST query SIA for area-specific verification requirements and known bugs. Without this, you will miss verification steps.
- [ ] Steps 1-5: IDENTIFY command → RUN fully → READ full output → VERIFY it confirms claim → ONLY THEN claim done. Skipping ANY step is a failed verification.
- [ ] Post: Capture any new verification requirements to graph. A verification that discovers new requirements but doesn't capture them leaves the next developer blind.
```

## Workflow

### Step 0 — SIA Requirements Query (NEW)

Before running verification commands:

```
sia_search({ query: "verification requirements testing <area>", node_types: ["Convention", "Decision"], limit: 10 })
sia_search({ query: "bugs failures <area>", node_types: ["Bug"], limit: 5 })
```

Check if this area has specific verification requirements:
- "This module requires integration tests, not just unit tests"
- "Changes to the API need backwards-compatibility verification"
- "The auth module had a bug with edge case X — verify it's still handled"

### Step 1-5 — Standard Verification Gate (enhanced)

Follow the standard gate function:
1. **IDENTIFY** what command proves the claim — enhanced by SIA's knowledge of project-specific verification commands
2. **RUN** the full command
3. **READ** full output
4. **VERIFY** output confirms the claim
5. **ONLY THEN** make the claim

**Enhancement:** If SIA surfaced area-specific requirements in Step 0, verify EACH ONE explicitly. Don't just run `bun run test` — also run any area-specific checks (e.g., `bun run typecheck`, `bun run lint`, integration tests).

### Post-Verification — Capture (NEW)

If verification revealed an issue that was fixed:

```
sia_note({ kind: "Convention", name: "Verification: <area> requires <specific check>", content: "<what verification is needed and why>" })
```

This builds up area-specific verification knowledge over time.

## Key Principle

**Different areas need different verification.** SIA learns what each area requires and reminds you before you declare "done."
