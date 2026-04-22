---
name: sia-setup
description: Guides first-time SIA setup — detects the project, configures the knowledge graph, indexes code and docs, and runs a tour. Use when setting up SIA for the first time in a new project.
---

# SIA First-Time Setup

Welcome to SIA! This wizard gets you set up in one step.

**For detailed phase guide with error recovery:** See [setup-checklist.md](setup-checklist.md)

## What This Does

1. Detects your project type, languages, and structure
2. Creates SIA databases and registers the repository
3. Indexes all source code with tree-sitter (25+ languages)
4. Ingests project documentation (README, ARCHITECTURE, ADRs, etc.)
5. Detects community structure (module clusters)
6. Gives you a tour of what was discovered

## Setup Process

### Step 1: Detect Project

First, let's understand your project:

```bash
# Detect project type
ls package.json Cargo.toml go.mod pyproject.toml requirements.txt Gemfile 2>/dev/null
# Count source files
find . -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.rb" \) -not -path "*/node_modules/*" -not -path "*/.git/*" | wc -l
# Check for existing docs
ls README.md ARCHITECTURE.md CLAUDE.md AGENTS.md docs/ 2>/dev/null
```

Present findings to the user:
> "I detected a TypeScript project with 342 source files, a README.md, and docs/ directory. Ready to set up SIA?"

### Step 2: Configure (optional questions)

Ask only if relevant:
- **Team sync:** "Will multiple developers use SIA on this project? If yes, I'll set up team sync later via `/sia-team`."
- **Large repo warning:** If >5,000 files: "This is a large repo. The first index may take a few minutes. Want to proceed?"

### Step 3: Run Learn

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts learn --verbose
```

This handles install + index + doc ingestion + community detection automatically.

### Step 4: Tour

After learning completes, run the tour:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts tour
```

Or invoke `/sia-tour` for an interactive walkthrough.

### Step 5: Summary

After setup completes, call the `sia_stats` MCP tool and display the graph
state so the user sees the bootstrap worked. Then suggest three follow-up
commands so there is an obvious next action.

Present what SIA learned, filling in real numbers from `sia_stats`:
> **SIA is ready!**
> - 342 code entities indexed across 142 files
> - 45 documentation chunks from 8 docs
> - 5 community clusters detected
> - 3 external references (Notion, Jira, GitHub)
>
> Try these next:
> - `/sia-search <topic>` — try a search to see if prior context was captured
> - `/sia-visualize-live` — open the graph in your browser
> - `/sia-learn --incremental` — update the graph as you continue working
>
> Other useful commands:
> - Ask me any question — SIA tools activate automatically
> - `/sia-status` — check graph health
> - `/sia-team` — set up team sync

## When To Use

- First time using SIA on a project
- After cloning a project that already has a SIA graph
- When you want a fresh start (`/sia-learn --force` then `/sia-setup`)
