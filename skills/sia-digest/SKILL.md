---
name: sia-digest
description: Use at daily standup, at sprint close, or on Monday morning to catch up on the weekend's captured decisions, bugs, and conventions. Summarises a rolling 24-hour window by default.
---

# SIA Digest

Generate a summary of recent knowledge captured in the graph.

## Usage

**When to invoke:**
- Start of a workday — "what did I/the team capture yesterday?"
- Daily standup prep
- User asks "what changed recently?" / "what's new in the graph?"

**Inputs:** No arguments. Defaults to a 24-hour window.

**Worked example:**

```bash
$ bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/digest.ts
# SIA Digest — 2026-04-21
## Decisions (2)
- Use Redis for rate limiting (api-gateway)
- Drop jQuery in favour of native fetch (docs-site)
## Conventions (1)
- All order tests seed via seedOrders() (orders module)
## Bugs & Solutions (1 / 1)
- Double-charge on payment retry → idempotency key fix
## Hot areas
- src/api/middleware.ts — 4 entity touches
```

## What It Shows

A markdown summary covering:
- Decisions made in the last 24 hours
- New conventions established
- Bugs discovered and solutions applied
- Code areas with the most activity
- Community-level changes
