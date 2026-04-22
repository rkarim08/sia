---
name: sia-augment
description: Toggle automatic graph-context enrichment of Grep/Glob/Bash tool results. Use when the user asks to enable/disable augmentation, when augmented output is noisy or distracting, or when debugging the PreToolUse augment-hook behavior.
---

# SIA Auto-Augmentation Toggle

Manages the auto-augmentation feature that enriches Grep/Glob/Bash tool results with graph context.

## Usage

- `/sia-augment on` -- Enable auto-augmentation (writes `true` to `.sia-graph/augment-enabled`)
- `/sia-augment off` -- Disable auto-augmentation (writes `false` to `.sia-graph/augment-enabled`)

## How It Works

When enabled, a PreToolUse hook intercepts Grep, Glob, and Bash tool calls. It extracts the search pattern, queries the SIA graph for related entities, and injects compact context (max ~500 tokens) into the tool result.

Session dedup ensures each pattern is only augmented once per session.

## Arguments

The first argument should be `on` or `off`:

```
/sia-augment on
/sia-augment off
```

Without arguments, reports the current status.

## Steps

1. Resolve the `.sia-graph` directory for the current project using git worktree root.
2. Based on the argument:
   - `on`: Write `true` to `.sia-graph/augment-enabled`
   - `off`: Write `false` to `.sia-graph/augment-enabled`
   - No argument: Read `.sia-graph/augment-enabled` and report whether augmentation is currently enabled or disabled. If the file does not exist, report "enabled (default)".
