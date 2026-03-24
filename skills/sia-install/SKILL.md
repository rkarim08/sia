---
name: sia-install
description: Initialize SIA persistent memory in the current project — creates databases, registers repo, configures hooks
---

# SIA Install

Initialize SIA's persistent graph memory for the current project.

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
