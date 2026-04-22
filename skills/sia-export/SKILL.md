---
name: sia-export
description: Use when (a) backing up or migrating a graph (`--format json`), or (b) generating a human-readable knowledge dump (`--format markdown`). Also handles JSON import via `--import <path>`.
---

# SIA Export

Export or import the knowledge graph. One skill, two output formats plus import.

## Usage

Select the mode with `--format`, or use `--import` to load a previous JSON export:

- `--format json` — portable JSON snapshot of entities/edges/communities (backup, migration, sharing)
- `--format markdown` — human-readable `KNOWLEDGE.md` (team onboarding, docs, stakeholder share)
- `--import <path>` — load a previous JSON export (with optional `--mode merge|replace`)

---

## `--format json` — Portable JSON export/import

Exports and imports SIA knowledge graphs as portable JSON for backup, migration, or sharing. Use when backing up the graph, migrating to a new machine, or sharing knowledge between projects.

**When to invoke:**
- Backup before a destructive operation (prune, mass invalidation)
- Migrating SIA between machines
- Sharing a snapshot with a teammate who isn't on team-sync

**Inputs:**
- Export: `--output <path>` (default `graph-export.json`)
- Import: `--import <path>` (required), `--mode merge|replace` (default `merge`)

**Worked example:**

```
$ /sia-export --format json --output ~/backups/sia-2026-04-21.json
[export] Wrote 2,431 entities, 6,104 edges, 6 communities (3.8MB)
$ /sia-export --import ~/backups/sia-2026-04-21.json --mode merge
[import] Consolidated 2,431 entities (14 merged into existing, 2,417 new)
```

### Export

Serialize the active graph (entities, edges, communities, cross-repo edges) to JSON:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/export.ts --output graph-export.json
```

The export includes:
- All active entities (not invalidated, not archived)
- All active edges
- All communities
- Cross-repo edges (if in a workspace)

### Import

Load a previously exported graph:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/import.ts --input graph-export.json --mode merge
```

#### Import Modes

- **merge** (default): Runs imported entities through the consolidation pipeline — deduplicates against existing entities and only creates new edges when both endpoints exist
- **replace**: Archives all existing active entities, then bulk-inserts everything from the export

### When To Use

- **Backup**: Export before major refactoring or destructive operations
- **Migration**: Move knowledge between machines or environments
- **Sharing**: Share project knowledge with team members who haven't run SIA
- **Recovery**: Restore from a previous export if something goes wrong (also see `sia-rollback`)

### Related

- Use `rollback` to restore from automatic snapshots:
  ```bash
  bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/rollback.ts
  ```

---

## `--format markdown` — Human-readable knowledge dump

Exports the knowledge graph as a human-readable markdown document covering decisions, conventions, bugs, and architecture. Use for team onboarding, documentation generation, or sharing knowledge outside SIA.

**Default** (writes to `KNOWLEDGE.md`):
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts export-knowledge
```

**Custom output path:**
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts export-knowledge --output docs/project-knowledge.md
```

**Custom project name:**
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts export-knowledge --name "My Project"
```

### What It Generates

A structured markdown document with:

1. **Architectural Decisions** — what was chosen, why, and what was rejected
2. **Coding Conventions** — patterns and rules to follow
3. **Known Issues** — active bugs with descriptions
4. **Solutions** — how past bugs were fixed
5. **Key Concepts** — domain terminology and system behavior
6. **Architecture** — community structure showing module clusters

Each entry includes: date captured, trust tier (verified/code-derived/inferred/external), and affected files.

### When To Use

- **Team onboarding** — share with new developers before their first session
- **Knowledge audit** — review what SIA has captured, identify gaps
- **External sharing** — generate a knowledge summary for stakeholders
- **Backup** — human-readable export of the knowledge graph
- **Documentation** — commit as living documentation alongside code

### Worked Example

```
$ /sia-export --format markdown --output docs/project-knowledge.md --name "Acme Platform"
[export-knowledge] Wrote docs/project-knowledge.md
  · 24 Decisions · 18 Conventions · 12 Bugs · 10 Solutions · 6 Concepts
  · Architecture section covers 6 communities
```
