---
name: sia-reindex
description: Re-index the repository with tree-sitter to update the SIA knowledge graph with current code structure
---

# SIA Reindex

Trigger a full or incremental re-index of the repository's code structure.

## Steps

Run the reindex command:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/reindex.ts
```

This will:
1. Walk the repository file tree (respecting .gitignore)
2. Parse each supported file with tree-sitter (25+ languages)
3. Extract symbols, imports, and call relationships
4. Update the knowledge graph with CodeSymbol, FileNode, and PackageNode entities
5. Recompute PageRank for structural importance

## When To Use

- After major refactoring
- When the graph seems stale or incomplete
- After pulling significant changes from remote
- When `sia-doctor` reports stale AST data
