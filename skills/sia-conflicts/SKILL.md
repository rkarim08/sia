---
name: sia-conflicts
description: Use when reconciling captured knowledge — any session that shows a `conflict_group_id` warning, before committing a change that depends on the conflicting facts.
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

## Worked Example

```
$ /sia-conflicts list
group cg-4f2c: 2 entities
  · ent-a1 "Session timeout = 15min" (Tier 1, captured 2026-01-12)
  · ent-b7 "Session timeout = 60min" (Tier 2, captured 2026-03-04)
$ /sia-conflicts resolve cg-4f2c ent-b7
[conflicts] Kept ent-b7. Invalidated ent-a1 (t_valid_until=2026-04-21T...).
```
