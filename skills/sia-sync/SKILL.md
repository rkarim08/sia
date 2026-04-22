---
name: sia-sync
description: Pushes or pulls SIA knowledge to/from the team sync server. Use when sharing knowledge with teammates, syncing after a long offline period, or receiving others' captured knowledge.
---

# SIA Manual Sync

Manually trigger a push or pull of knowledge to/from the team sync server.

Sync normally happens automatically (pull on session start, push on session end). Use this skill when you want to sync mid-session — for example, when you know a teammate just finished capturing important decisions.

## Usage

**When to invoke:**
- Mid-session, when a teammate just captured something you need
- After a long offline stretch — pull before starting
- Before a presentation or review, to ensure you have the latest team knowledge

**Inputs:** No arguments for the combined `sync`; `push` or `pull` as subcommands.

**Worked example:**

```
$ /sia-sync
[sync] Push: 5 entities, 12 edges, 0 bridge edges
[sync] Pull: 3 entities, 8 edges, 2 VSS refreshed
```

## Push Local Knowledge

Push your locally captured knowledge to the team:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts sync push
```

## Pull Team Knowledge

Pull knowledge from teammates:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts sync pull
```

## Push and Pull

Do both (push first, then pull):

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts sync
```

## Output

The command reports what was synced:
```
Push: 5 entities, 12 edges, 0 bridge edges
Pull: 3 entities, 8 edges, 2 VSS refreshed
```

## Prerequisites

Team sync must be configured first. Run `/sia-team` to set up.
