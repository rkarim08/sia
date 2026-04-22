# `agents/` — Sia Subagent Library

Each file in this directory defines one Claude Code subagent. Filename becomes
the dispatch key: `agents/sia-code-reviewer.md` → `@sia-code-reviewer`.

End-user dispatch guidance lives in
[`PLUGIN_USAGE.md`](../PLUGIN_USAGE.md). This file is for contributors
authoring new agents or modifying existing ones.

## Agent file shape

```markdown
---
name: sia-<role>
description: One sentence the dispatcher reads to decide when to invoke.
model: sonnet            # Always sonnet unless there is a documented reason otherwise.
color: <palette-color>   # See palette below.
tools: <comma-separated list of granted tools>
whenToUse: |             # Optional but strongly encouraged — multi-example block.
  <prose + <example> blocks>
---

# <Agent Title>

<System prompt body — workflow, inputs, outputs, guardrails.>
```

## Color palette (Phase 4 semantic palette)

Colors carry meaning; reuse an existing bucket rather than introducing a new one.

| Color  | Meaning                                       | Example agents                                        |
|--------|-----------------------------------------------|-------------------------------------------------------|
| blue   | Orient / explain / onboard                    | sia-orientation, sia-onboarding, sia-explain          |
| green  | Generator / creator (writes artifacts)        | sia-feature, sia-pr-writer, sia-changelog-writer      |
| red    | Debug / incident / risk                       | sia-debug-specialist, sia-regression, sia-security-audit |
| cyan   | Review / quality / compliance                 | sia-code-reviewer, sia-convention-enforcer, sia-qa-*  |
| purple | Planning / advising / architecture            | sia-decision-reviewer, sia-refactor, sia-test-advisor |

## Tool-grant conventions

Grant only what the agent genuinely needs. Avoid broad grants.

- **Always include** `Read, Grep, Glob, Bash` for any agent that inspects source.
- **Retrieval agents** get `mcp__sia__sia_search`, `mcp__sia__sia_by_file`, `mcp__sia__sia_community` as needed.
- **Writer agents** additionally get `mcp__sia__sia_note` if they should capture findings.
- **Temporal agents** get `mcp__sia__sia_at_time` and `mcp__sia__sia_backlinks` only if the workflow reasons about history.
- **Never grant** `nous_modify` to a subagent — the MCP tool is already blocked for subagents in-server, and the agent-local list should match.

The `name:`, `description:`, and `tools:` fields are all validated by
`scripts/validate-plugin.sh` — run the validator before committing.

## Authoring a new agent

1. Confirm the agent has a crisp, specific role that no existing agent covers.
2. Copy an agent with a similar shape (`sia-pr-writer.md` is a compact template).
3. Fill `whenToUse` with at least two `<example>` blocks showing concrete triggers.
4. Write the system-prompt body: workflow steps, inputs, outputs, guardrails.
5. Pick a color from the palette above.
6. Run `bash scripts/validate-plugin.sh` — fails on missing frontmatter, bad tool names, or drift against agent counts in README / PLUGIN_README / PLUGIN_USAGE.
7. Add a matching `commands/<name>.md` shim if users should be able to dispatch via `/<name>`.
8. Update [`PLUGIN_USAGE.md`](../PLUGIN_USAGE.md) — add the agent to the Agents table.

## Related directories

- [`../commands/README.md`](../commands/README.md) — slash-command palette (many agents have matching commands).
- [`../skills/README.md`](../skills/README.md) — skills vs agents: skills are step-by-step guides executed by the main thread; agents are sub-sessions dispatched in parallel with their own tool grants.
