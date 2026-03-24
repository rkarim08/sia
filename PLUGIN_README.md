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

#### Search & Retrieval

| Tool | Description |
|---|---|
| `sia_search` | Semantic search across the knowledge graph |
| `sia_by_file` | Look up knowledge for a specific file |
| `sia_expand` | Explore entity neighborhoods (1-3 hops) |
| `sia_community` | Get community-level summaries |
| `sia_at_time` | Query the graph at a historical point |
| `sia_backlinks` | Find incoming edges to a node |

#### Knowledge Capture

| Tool | Description |
|---|---|
| `sia_note` | Record a Decision, Convention, Bug, Solution, or Concept |
| `sia_flag` | Flag current session for human review (writes to session_flags only) |
| `sia_index` | Index markdown/text content by chunking and scanning for entity references |
| `sia_fetch_and_index` | Fetch a URL, convert to markdown, and index |

#### Sandbox Execution

| Tool | Description |
|---|---|
| `sia_execute` | Execute code in an isolated sandbox |
| `sia_execute_file` | Execute an existing file in a sandbox subprocess |
| `sia_batch_execute` | Execute multiple operations in one call with precedes edges |

#### Diagnostics & Maintenance

| Tool | Description |
|---|---|
| `sia_stats` | Graph metrics — node/edge counts by type, optional session stats |
| `sia_doctor` | Run diagnostic checks on the installation |
| `sia_upgrade` | Self-update SIA to the latest version |
| `sia_sync_status` | Check team sync configuration and connection status |

### Skills (slash commands)

#### Core

| Skill | Description |
|---|---|
| `/sia-install` | Initialize SIA in current project |
| `/sia-search` | Guided search with examples |
| `/sia-stats` | Graph statistics |
| `/sia-reindex` | Re-index repository code |

#### Knowledge Management

| Skill | Description |
|---|---|
| `/sia-execute` | Run code in sandbox with knowledge capture |
| `/sia-index` | Index external content (text, URLs) |
| `/sia-workspace` | Manage cross-repo workspaces |
| `/sia-export-import` | Export/import graphs as portable JSON |

#### Maintenance

| Skill | Description |
|---|---|
| `/sia-doctor` | System health diagnostics |
| `/sia-digest` | Daily knowledge summary |
| `/sia-visualize` | Generate HTML graph visualization |
| `/sia-freshness` | Graph freshness report |
| `/sia-conflicts` | List and resolve knowledge conflicts |
| `/sia-prune` | Remove archived entities |
| `/sia-upgrade` | Self-update SIA |

#### Team Sync

| Skill | Description |
|---|---|
| `/sia-team` | Join, leave, or check team sync status |
| `/sia-sync` | Manual push/pull to/from team server |

### Subagents

| Agent | Purpose | Can Run In Parallel |
|---|---|---|
| `sia-code-reviewer` | Code review with graph context — convention enforcement, regression detection | Yes |
| `sia-orientation` | Project onboarding — architecture, decisions, conventions, known issues | Yes |
| `sia-regression` | Regression risk analysis — temporal investigation of what changed and when | Yes |
| `sia-feature` | Feature development — architectural context, dependency and convention awareness | Yes |

All subagents are read-only against the knowledge graph and can run simultaneously.
Invoke via `@sia-code-reviewer`, `@sia-orientation`, etc.

### Automatic Hooks

| Hook | Trigger | Purpose |
|---|---|---|
| **PostToolUse** | Write/Edit | Captures knowledge from file changes |
| **Stop** | Session stop | Detects uncaptured knowledge patterns |
| **SessionStart** | Session begin | Injects recent decisions/conventions as context |
| **PreCompact** | Before compaction | Scans transcript tail for unextracted knowledge before context compaction |
| **PostCompact** | After compaction | Logs compaction coverage for observability |
| **SessionEnd** | Session exit | Records session statistics and entity counts |
| **UserPromptSubmit** | User prompt | Captures user prompts and detects correction/preference patterns |

## Team Sync

SIA supports team knowledge sharing via a self-hosted sqld (libSQL) server.

### Setup

1. DevOps deploys a sqld server (see `docs/team-sync-deployment.md`)
2. DevOps provides a server URL and auth token
3. Developer runs: `/sia-team` → follow setup instructions

### Automatic Sync

| Event | Action |
|---|---|
| Session start | Auto-pulls latest team knowledge |
| Session end | Auto-pushes locally captured knowledge |
| `/sia-sync` | Manual push/pull on demand |

### Skills & Tools

| Component | Purpose |
|---|---|
| `/sia-team` | Join, leave, or check team status |
| `/sia-sync` | Manual push/pull operations |
| `sia_sync_status` MCP tool | Programmatic sync status check |

## Requirements

- [Bun](https://bun.sh/) runtime installed
- Git repository (for repo identification and change tracking)

## Data Storage

- **Per-project:** Graph database in `~/.sia/repos/{repo-hash}/`
- **Plugin-global:** Configuration and models in `$CLAUDE_PLUGIN_DATA/`
