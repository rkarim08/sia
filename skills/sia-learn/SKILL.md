---
name: sia-learn
description: Builds or refreshes SIA's complete knowledge graph — indexes code with tree-sitter, ingests docs, and detects communities. Use after major codebase changes, initial setup, or when the graph needs a full refresh.
---

# SIA Learn

Build the complete knowledge graph for the current repository in one step.

## What This Does

1. **Install** (if needed) — creates SIA databases, registers the repo
2. **Index code** — tree-sitter parse of all source files (25+ languages), extracts symbols, imports, calls
3. **Ingest docs** — discovers and parses README.md, CLAUDE.md, ARCHITECTURE.md, ADRs, API docs, changelogs
4. **Detect communities** — clusters related code into communities, generates summaries
5. **Report** — prints what was learned

## Usage

**Full build** (first time or rebuild):
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts learn
```

**Incremental update** (fast — only changed files):
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts learn --incremental
```

**Force rebuild** (ignore caches and snapshots):
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts learn --force
```

**Quiet mode** (summary only):
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts learn --quiet
```

## Crash Recovery

If the process crashes mid-run (OOM, Ctrl+C, power loss), re-running `/sia-learn` automatically resumes from the last checkpoint. A `.sia-learn-progress.json` file tracks progress and is deleted on successful completion.

## When To Use

- First time setting up SIA on a project
- After pulling major changes from remote
- When the knowledge graph feels stale or incomplete
- After a large refactoring
- When onboarding to a new codebase

## Worked Example

```
$ /sia-learn --incremental
[sia] Indexing changed files (3)...
[sia] Parsed src/auth/login.ts → 4 entities, 6 edges
[sia] Parsed src/auth/session.ts → 2 entities, 3 edges
[sia] Parsed docs/ADR-012-auth.md → 1 Decision
[sia] Community re-cluster: 2 communities touched
[sia] Done in 4.2s — 7 new entities, 9 new edges, 1 Decision
```

Subsequent `sia_search`, `sia_by_file`, and `sia_community` calls immediately see the new entities.

## After Learning

Use SIA's MCP tools to query the knowledge graph:
- `sia_search` — semantic search across all knowledge
- `sia_community` — browse community-level summaries
- `sia_by_file` — look up knowledge for specific files
- `sia_expand` — explore entity neighborhoods
