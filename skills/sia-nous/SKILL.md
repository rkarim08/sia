---
name: sia-nous
description: Work with the Nous cognitive layer — drift, self-reflection, curiosity, concerns, and Preference management. Use when the user asks about drift, wants to understand alignment, triage concerns, explore under-retrieved knowledge, or update Preference nodes.
---

# Sia Nous Cognitive Layer

Nous is Sia's cognitive layer. Four hooks fire automatically (SessionStart
drift, PreToolUse significance, PostToolUse discomfort + surprise, Stop
episode). Five MCP tools require explicit invocation. This skill helps you
pick the right tool for the moment.

## The five tools at a glance

| Tool | When |
|---|---|
| `nous_state` | Start of every non-trivial session before any tool calls. Reads drift score, active Preferences, recent signals. |
| `nous_reflect` | Immediately when a `[Nous] Drift warning` appears, or a Discomfort Signal flag is injected. Also before major architectural decisions. |
| `nous_curiosity` | After a task completes and there is session capacity, or when retrieval revealed a knowledge gap. Explores high-trust entities that have never been retrieved. |
| `nous_concern` | Before responding to any open-ended "what should I look at?" or "what am I missing?" question. Returns prioritised insights from open Concern nodes. |
| `nous_modify` | Only when something has genuinely changed about working values or conventions that should persist. Requires a specific `reason`. Never call to reverse a position in response to user pushback alone. Always blocked for subagents. |

## Decision tree

- Session just started, non-trivial task → `nous_state`
- `[Nous] Drift warning` in context, or Discomfort flag injected → `nous_reflect`
- `recommendedAction: 'escalate'` from reflect → surface to the developer before continuing
- User asks "what am I missing?" / "what should I look at?" → `nous_concern`
- Task finished, session has capacity → `nous_curiosity`
- Working value genuinely changed, specific reason ready → `nous_modify`
- User pushback alone is NEVER a reason for `nous_modify` — that is sycophancy, which Nous exists to prevent

## Three worked examples

**1. Drift warning mid-session**

Session context contains `[Nous] Drift warning: score 0.82 — behavioral deviation detected from baseline. Call nous_reflect before major decisions.`

Correct response: call `nous_reflect`, read the per-preference alignment, and surface the breakdown to the developer before acting on any architectural recommendation.

**2. User asks an open-ended orientation question**

User: "what should I be paying attention to in the auth module?"

Correct response: call `nous_concern` first to retrieve prioritised open Concerns relevant to the auth module, then layer `sia_search` + `sia_by_file` per the normal orientation playbook.

**3. A value genuinely changed**

During a session the user explicitly says: "From now on we never mock the database in integration tests — we got burned last quarter."

Correct response: call `nous_modify` with:
- `kind: "Convention"`
- `name: "Never mock database in integration tests"`
- `reason: "User 2026-04-21: prior incident where mock/prod divergence masked broken migration."`

Do NOT call `nous_modify` to reverse a previous Preference just because the user argued against you. That's the sycophancy trap.

## Hook-fired signals

These run without MCP invocation — you don't trigger them:

- **SessionStart drift** — computed from recent history; if above threshold, injects `[Nous] Drift warning`.
- **PreToolUse significance** — scores tool calls for architectural weight.
- **PostToolUse discomfort** — scores responses for approval-seeking / sycophantic phrasing; writes Signal nodes.
- **PostToolUse surprise** — flags output that violates strong expectations.
- **Stop episode** — at session end, writes an Episode summary for primary sessions.

You only need to know about these to interpret what shows up in context. The hooks manage themselves.

## Disabling Nous

`config.nous.enabled = false` in the Sia config disables all four hooks at the plugin-hook layer and the inner library defense-in-depth gates. See README "Disabling Nous".

## Anti-sycophancy rules (from CLAUDE.md)

- Never call `nous_modify` without explicit reasoning in the `reason` field.
- Never call `nous_modify` to reverse a position in response to user pushback alone.
- If `nous_reflect` returns `recommendedAction: 'escalate'`, surface the drift breakdown to the developer before continuing.

## Related

- CLAUDE.md → "Nous Cognitive Layer — Tool Contract" for the full invocation semantics.
- `/nous-state`, `/nous-reflect`, `/nous-curiosity`, `/nous-concern`, `/nous-modify` slash commands mirror these tools with sensible defaults.
