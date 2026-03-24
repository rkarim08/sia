---
name: sia-capture
description: Guided knowledge capture session — walks through noting decisions, conventions, bugs, and solutions from recent work into SIA's graph
---

# SIA Knowledge Capture

A guided session to capture important knowledge from your recent work into SIA's persistent graph.

## How It Works

I'll review your recent changes and walk you through capturing each piece of knowledge. For each item, I'll suggest a `sia_note` call and ask for your confirmation.

## Capture Process

### 1. Review recent changes

```bash
git log --oneline -20
git diff --stat HEAD~5
```

### 2. For each significant change, check if it's already captured

```
sia_search({ query: "<change description>", limit: 5 })
```

### 3. For uncaptured knowledge, suggest a note

I'll present each finding and ask:

> **Decision found:** You chose to use middleware for auth instead of inline checks.
> Shall I capture this?
> ```
> sia_note({ kind: "Decision", name: "Use middleware for authentication", content: "Chose Express middleware pattern over inline auth checks in route handlers because..." })
> ```

### 4. Categories to check

| Category | What to look for | Example |
|---|---|---|
| **Decisions** | Architecture choices, library selections, pattern choices | "Use Redis for rate limiting" |
| **Conventions** | New patterns established, style rules | "All API responses use { data, error } shape" |
| **Bugs** | Root causes discovered, error conditions | "Race condition when two users edit same doc" |
| **Solutions** | Fixes applied, workarounds | "Added optimistic locking to prevent race" |
| **Concepts** | Domain terms defined, system behavior explained | "A 'workspace' is a collection of repos" |

### 5. Quality checklist

For each note, verify:
- [ ] Name is specific and searchable
- [ ] Content includes the WHY, not just the WHAT
- [ ] Alternatives considered are mentioned (for Decisions)
- [ ] Affected files are referenced
- [ ] Related entities are linked via `relates_to`

## When To Use

- End of a significant work session
- After completing a feature
- After fixing a complex bug
- During a knowledge audit
- When onboarding (capture tribal knowledge from a colleague)
