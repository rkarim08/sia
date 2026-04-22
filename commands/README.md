# `commands/` — Slash Command Palette

This directory holds every user-facing `/command` shipped by the Sia plugin.
Each file here becomes a single Claude Code slash command. The filename
(without `.md`) is the command name: `commands/search.md` → `/search`.

For end-user usage of each command, see
[`PLUGIN_USAGE.md`](../PLUGIN_USAGE.md). This file is for contributors
authoring or editing commands.

## What a command file contains

Every command file has YAML frontmatter and a body:

```markdown
---
description: One-line summary shown in the palette.
argument-hint: <query>               # Only if the body references $ARGUMENTS or $1
---

Body — either forwards to a skill, dispatches an agent, or invokes an MCP tool.
```

### Frontmatter fields

| Field           | Required | Notes                                                                    |
|-----------------|----------|--------------------------------------------------------------------------|
| `description`   | Yes      | Present tense, < 80 chars, no trailing period.                           |
| `argument-hint` | Conditional | **MUST** be present if the body references `$ARGUMENTS` or `$1`.      |

## Three command shapes

Commands fall into one of three patterns:

1. **Skill shim** — forwards to a skill with the same semantic name.
   ```
   Run the `/sia-<name>` skill.
   ```

2. **Agent-dispatch shim** — dispatches an agent with a one-line flavor note.
   ```
   Dispatch the `@sia-<name>` agent. See [`agents/sia-<name>.md`](../agents/sia-<name>.md) — at a glance: <one line>.
   ```

3. **Direct MCP wrapper** — calls an MCP tool directly, usually with arguments.
   Examples: `at-time.md`, `community.md`, `freshness.md`, the five `nous-*` commands.
   These contain richer guidance and worked examples.

## Authoring a new command

1. Decide the shape — does an existing skill or agent already do this? If yes, shim it.
2. Add `commands/<name>.md` with correct frontmatter.
3. If the body uses `$ARGUMENTS` or `$1`, add `argument-hint:` to the frontmatter.
4. Run `bash scripts/validate-plugin.sh` — the validator checks frontmatter shape and counts.
5. Update [`PLUGIN_USAGE.md`](../PLUGIN_USAGE.md) if the new command adds a user-facing workflow worth surfacing (direct MCP wrappers usually do; shims usually don't).

## Related directories

- [`../skills/README.md`](../skills/README.md) — the skills layer that most commands shim to.
- [`../agents/README.md`](../agents/README.md) — the agents layer that `*-agent` commands dispatch to.
- [`../hooks/README.md`](../hooks/README.md) — automatic hook handlers (not user-invocable).
