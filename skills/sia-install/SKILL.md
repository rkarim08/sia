---
name: sia-install
description: Initializes SIA persistent memory in the current project — creates databases, registers repo, and configures hooks. Use for first-time SIA setup in a new project or repository.
---

# SIA Install

Initialize SIA's persistent graph memory for the current project.

## Usage

**When to invoke:**
- First-time SIA setup in a new repo
- Adopting SIA on an existing repo that hasn't been indexed
- Re-creating databases after an intentional reset

**Inputs:** No arguments. Reads the current git repo from the working directory.

**Worked example:**

```bash
$ /sia-install
[install] Created graph.db, episodic.db
[install] Registered repo 'sia' in meta.db (repo_id=r_4f2c)
[install] Ready — run /sia-learn to populate the graph
```

Prefer `/sia-setup` for guided first-run (includes learn + tour). Use `/sia-install` only when you want the DB scaffold without indexing.

## What This Does

1. Creates the SIA databases (graph.db, episodic.db) for this repository
2. Registers the repo in the global meta.db registry
3. Runs an initial AST index of the codebase using tree-sitter

## Steps

1. Run the SIA install command:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/install.ts
```

2. Verify the databases were created by checking `~/.sia/` (or `$CLAUDE_PLUGIN_DATA` in plugin mode)

3. Run an initial reindex to populate the knowledge graph:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/reindex.ts
```

4. Confirm SIA is working by running a test search using the `sia_search` MCP tool with query "project overview".

## Troubleshooting

If installation fails:
- Run `sia-doctor` to check system health
- Ensure bun is installed (`bun --version`)
- Check that the project is a git repository (`git rev-parse --git-dir`)
