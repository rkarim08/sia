---
name: sia-conflicts
description: List and resolve knowledge conflicts in the SIA graph — when multiple entities contradict each other
---

# SIA Conflicts

Manage knowledge conflicts in the graph. Conflicts occur when SIA captures contradictory information (e.g., two different decisions about the same topic).

## List Conflicts

Show all active conflict groups:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/conflicts.ts list
```

This returns conflict groups — each group contains entity IDs that contradict each other.

## Resolve a Conflict

Choose which entity to keep, invalidating the others:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/conflicts.ts resolve <group-id> <keep-entity-id>
```

This:
1. Keeps the chosen entity active
2. Invalidates all other entities in the conflict group (sets `t_valid_until`)
3. Writes an audit entry recording the resolution

## When To Use

- When `sia-doctor` reports unresolved conflicts
- When search results return contradictory information
- After importing knowledge from another source
- When conventions or decisions have been superseded
