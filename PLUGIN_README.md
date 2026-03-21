# SIA — Claude Code Plugin

Persistent graph memory for AI coding agents. SIA gives Claude Code cross-session memory via a bi-temporal knowledge graph.

## Installation

```bash
claude plugin add sia
```

Or for local development:

```bash
claude --plugin-dir /path/to/sia
```

## Features

### MCP Tools (always available)

| Tool | Description |
|---|---|
| `sia_search` | Semantic search across the knowledge graph |
| `sia_by_file` | Look up knowledge for a specific file |
| `sia_expand` | Explore entity neighborhoods (1-3 hops) |
| `sia_community` | Get community-level summaries |
| `sia_at_time` | Query the graph at a historical point |
| `sia_flag` | Flag current session for review |
| `sia_note` | Record a Decision, Convention, Bug, Solution, or Concept |
| `sia_backlinks` | Find incoming edges to a node |

### Skills (slash commands)

| Skill | Description |
|---|---|
| `/sia-install` | Initialize SIA in current project |
| `/sia-search` | Guided search with examples |
| `/sia-stats` | Graph statistics |
| `/sia-reindex` | Re-index repository code |
| `/sia-doctor` | System health diagnostics |
| `/sia-digest` | Daily knowledge summary |
| `/sia-visualize` | Generate HTML graph visualization |

### Automatic Hooks

- **PostToolUse (Write/Edit):** Captures knowledge from file changes
- **Stop:** Detects uncaptured knowledge patterns at session end
- **SessionStart:** Injects recent decisions/conventions as context

## Requirements

- [Bun](https://bun.sh/) runtime installed
- Git repository (for repo identification and change tracking)

## Data Storage

- **Per-project:** Graph database in `~/.sia/{repo-hash}/`
- **Plugin-global:** Configuration and models in `$CLAUDE_PLUGIN_DATA/`
