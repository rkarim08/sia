---
name: sia-nous
description: Nous is Sia's cognitive layer — drift monitoring, self-reflection, curiosity-driven graph exploration, and anti-sycophancy guardrails. Use this skill to understand when and how to call the five `nous_*` MCP tools during a session.
---

# Sia Nous — Cognitive Layer

Nous runs beside Sia's memory graph. Four hooks fire automatically (SessionStart drift, PreToolUse significance, PostToolUse discomfort + surprise, Stop episode). Five MCP tools require explicit invocation.

## The five tools

- **`nous_state`** — Read current drift score, active Preferences, recent signals. Call at the start of every non-trivial session, before any tool calls.
- **`nous_reflect`** — Full self-monitor pass with per-preference breakdown and a recommended action. Call when a `[Nous] Drift warning` is injected, when a Discomfort Signal flag appears, or before a major architectural decision.
- **`nous_curiosity`** — Explore high-trust, under-retrieved graph entities and write them as open Concerns. Call when a task completes with spare capacity or a knowledge gap is visible.
- **`nous_concern`** — Surface open Concerns weighted by active Preferences. Call before responding to open-ended "what should I look at?" questions.
- **`nous_modify`** — Create, update, or deprecate a Preference node. Gated: blocked for subagents, blocked when drift > 0.90, Tier 1 edits require explicit developer confirmation.

## Anti-sycophancy rules (from CLAUDE.md)

- Never call `nous_modify` without a specific `reason`.
- Never call `nous_modify` to reverse a position in response to user pushback alone — that is sycophancy, which Nous exists to prevent.
- If `nous_reflect` returns `recommendedAction: 'escalate'`, surface the drift breakdown to the developer before continuing.
- Never silently override a Preference node. If the user pushes back, acknowledge the pushback, then verify against the Preference before acting.

## Slash commands

Five matching commands are provided:

- `/nous-state` → `nous_state`
- `/nous-reflect [context]` → `nous_reflect`
- `/nous-curiosity [topic]` → `nous_curiosity`
- `/nous-concern [context]` → `nous_concern`
- `/nous-modify <reason>` → `nous_modify`

See `CLAUDE.md` → "Nous Cognitive Layer — Tool Contract" for the authoritative tool semantics.
