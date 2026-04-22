---
name: sia-export-import
description: Exports and imports SIA knowledge graphs as portable JSON for backup, migration, or sharing. Use when backing up the graph, migrating to a new machine, or sharing knowledge between projects.
---

# SIA Export & Import

Export the knowledge graph to portable JSON or import from a previous export.

## Usage

**When to invoke:**
- Backup before a destructive operation (prune, mass invalidation)
- Migrating SIA between machines
- Sharing a snapshot with a teammate who isn't on team-sync

**Inputs:**
- Export: `--output <path>` (default `graph-export.json`)
- Import: `--input <path>` (required), `--mode merge|replace` (default `merge`)

**Worked example:**

```
$ /sia-export-import export --output ~/backups/sia-2026-04-21.json
[export] Wrote 2,431 entities, 6,104 edges, 6 communities (3.8MB)
$ /sia-export-import import --input ~/backups/sia-2026-04-21.json --mode merge
[import] Consolidated 2,431 entities (14 merged into existing, 2,417 new)
```

## Export

Serialize the active graph (entities, edges, communities, cross-repo edges) to JSON:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/export.ts --output graph-export.json
```

The export includes:
- All active entities (not invalidated, not archived)
- All active edges
- All communities
- Cross-repo edges (if in a workspace)

## Import

Load a previously exported graph:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/import.ts --input graph-export.json --mode merge
```

### Import Modes

- **merge** (default): Runs imported entities through the consolidation pipeline — deduplicates against existing entities and only creates new edges when both endpoints exist
- **replace**: Archives all existing active entities, then bulk-inserts everything from the export

## When To Use

- **Backup**: Export before major refactoring or destructive operations
- **Migration**: Move knowledge between machines or environments
- **Sharing**: Share project knowledge with team members who haven't run SIA
- **Recovery**: Restore from a previous export if something goes wrong (also see `sia-rollback`)

## Related

- Use `rollback` to restore from automatic snapshots:
  ```bash
  bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/rollback.ts
  ```
