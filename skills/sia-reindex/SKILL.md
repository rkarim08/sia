---
name: sia-reindex
description: Use after a major refactor, mass file rename, or tree-sitter grammar upgrade — triggers a full re-index of the repo's AST-derived entities. Reach for this when incremental reindex isn't enough and you want the walker from scratch.
---

# SIA Reindex

Trigger a full or incremental re-index of the repository's code structure.

## Usage

**Inputs:** No arguments.

**Worked example:**

```
$ /sia-reindex
[reindex] Walked 1,204 files (skipped 87 via .gitignore)
[reindex] Parsed with native tree-sitter: TypeScript, JS, Python, Go
[reindex] Updated 2,431 CodeSymbol entities, 6,104 edges
[reindex] Recomputed PageRank in 1.8s
```

Use `/sia-learn --incremental` for the faster changed-files-only path; `/sia-reindex` does a full walk.

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
