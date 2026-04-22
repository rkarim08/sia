---
description: Create, update, or deprecate a Nous Preference node — persistent working value
argument-hint: <reason for the change>
---

Call the `nous_modify` MCP tool. A `reason` is always required:

```
nous_modify({ action: "create" | "update" | "deprecate", preference: { ... }, reason: "$ARGUMENTS" })
```

### Safety rules (from CLAUDE.md)

- **Never** call `nous_modify` to reverse a position in response to user pushback alone — that is sycophancy, which Nous exists to prevent.
- Only call when something has genuinely changed about the working values or conventions that should persist across **all future sessions**.
- Tier 1 preferences require explicit developer confirmation; the tool returns `confirmationRequired: true` without mutating anything in that case.
- Blocked for subagents and when drift > 0.90.

If the developer has not supplied a clear reason, ask them for one before calling the tool.

### Worked example

During a session the user says: "From now on we never mock the database in integration tests — we got burned last quarter when a mock hid a broken migration."

```
nous_modify({
  action: "create",
  preference: {
    kind: "Convention",
    name: "Never mock database in integration tests",
    tier: 1
  },
  reason: "User 2026-04-21: prior incident where mock/prod divergence masked a broken migration in Q1. Persist across all future sessions."
})
// → { confirmationRequired: true, preference_id: "pref-4f2c" }
```

Tier 1 preferences require explicit developer confirmation; present the draft and wait for approval before re-calling with `confirm: true`.
