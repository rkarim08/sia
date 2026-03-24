---
name: sia-verify
description: Verify work is complete using SIA's knowledge of area-specific requirements, past verification failures, and known gotchas — evidence before assertions
---

# SIA-Enhanced Verification

Verify that work is truly complete, informed by SIA's knowledge of what's gone wrong before in this area.

## What SIA Adds

Standard verification says "run tests and check the output." SIA-enhanced verification also:
- **Checks area-specific requirements** — some modules need integration tests, not just unit tests
- **Surfaces known gotchas** — past bugs that affect this area
- **Recalls verification history** — what verifications have failed before for this codebase

## Enhanced Verification

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
