---
name: sia-learn
description: Build or refresh SIA's complete knowledge graph — indexes code with tree-sitter, ingests markdown docs, detects communities, and reports what was learned
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

## After Learning

Use SIA's MCP tools to query the knowledge graph:
- `sia_search` — semantic search across all knowledge
- `sia_community` — browse community-level summaries
- `sia_by_file` — look up knowledge for specific files
- `sia_expand` — explore entity neighborhoods
