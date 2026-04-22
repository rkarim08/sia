# SIA — Claude Code Plugin

Persistent graph memory for AI coding agents. SIA gives Claude Code cross-session memory via a bi-temporal knowledge graph.

## Installation

```bash
# From marketplace (installs at user scope — available in all projects)
/plugin install sia@sia-plugins
```

Or for local development (project-scoped by design):

```bash
claude --plugin-dir /path/to/sia
```

> **Note:** Local development mode (`--plugin-dir`) is project-scoped.
> For cross-project usage, install from the marketplace.

### Full component usage

See [PLUGIN_USAGE.md](PLUGIN_USAGE.md) for per-skill, per-agent, per-command usage guides with invocation triggers and worked examples.

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

#### AST & Code Analysis

| Tool | Description |
|---|---|
| `sia_ast_query` | Run tree-sitter queries against source files for structural code analysis |

#### Branch Snapshots

| Tool | Description |
|---|---|
| `sia_snapshot_list` | List branch snapshots with timestamps and entity counts |
| `sia_snapshot_restore` | Restore graph state from a branch snapshot |
| `sia_snapshot_prune` | Remove snapshots for deleted or merged branches |

#### Diagnostics & Maintenance

| Tool | Description |
|---|---|
| `sia_stats` | Graph metrics — node/edge counts by type, optional session stats |
| `sia_doctor` | Run diagnostic checks on the installation |
| `sia_upgrade` | Self-update SIA to the latest version |
| `sia_sync_status` | Check team sync configuration and connection status |

### Skills (47 slash commands)

#### Core

| Skill | Description |
|---|---|
| `/sia-install` | Initialize SIA in current project |
| `/sia-search` | Guided search with examples |
| `/sia-stats` | Graph statistics |
| `/sia-status` | Knowledge graph health dashboard |
| `/sia-reindex` | Re-index repository code |
| `/sia-learn` | Build or refresh the complete knowledge graph |
| `/sia-playbooks` | Load task-specific playbooks (regression, feature, review, orientation) |

#### Knowledge Management

| Skill | Description |
|---|---|
| `/sia-capture` | Guided knowledge capture — decisions, conventions, bugs, solutions |
| `/sia-execute` | Run code in sandbox with knowledge capture |
| `/sia-index` | Index external content (text, URLs) |
| `/sia-workspace` | Manage cross-repo workspaces |
| `/sia-export-import` | Export/import graphs as portable JSON |
| `/sia-export-knowledge` | Export graph as human-readable KNOWLEDGE.md |
| `/sia-history` | Explore temporal knowledge evolution |
| `/sia-impact` | Analyze impact of planned code changes |
| `/sia-compare` | Compare graph state between two time points |

#### Development Workflow

| Skill | Description |
|---|---|
| `/sia-brainstorm` | Brainstorm features using graph context |
| `/sia-plan` | Write implementation plans with graph topology |
| `/sia-execute-plan` | Execute plans with staleness detection and convention checks |
| `/sia-dispatch` | Dispatch parallel agents with community-based independence verification |
| `/sia-test` | TDD guided by known edge cases and test conventions |
| `/sia-verify` | Verify work completeness against area-specific requirements |
| `/sia-debug-workflow` | Systematic debugging with temporal root-cause tracing |
| `/sia-finish` | Finish branches — semantic PR summaries from graph entities |
| `/sia-review-respond` | Respond to code review feedback with graph-backed evidence |

#### Maintenance

| Skill | Description |
|---|---|
| `/sia-doctor` | System health diagnostics |
| `/sia-digest` | Daily knowledge summary |
| `/sia-visualize` | Generate HTML graph visualization |
| `/sia-visualize-live` | Launch interactive browser-based graph visualizer |
| `/sia-freshness` | Graph freshness report |
| `/sia-conflicts` | List and resolve knowledge conflicts |
| `/sia-prune` | Remove archived entities |
| `/sia-upgrade` | Self-update SIA |

#### Onboarding

| Skill | Description |
|---|---|
| `/sia-setup` | Guided first-time setup with checklist |
| `/sia-tour` | Interactive guided tour of the knowledge graph |

#### Team Sync

| Skill | Description |
|---|---|
| `/sia-team` | Join, leave, or check team sync status |
| `/sia-sync` | Manual push/pull to/from team server |

#### QA & Testing Intelligence

| Skill | Description |
|---|---|
| `/sia-qa-report` | QA-focused report — risky areas, test priorities |
| `/sia-qa-coverage` | Test coverage gap analysis from the knowledge graph |
| `/sia-qa-flaky` | Track flaky test patterns and recurring failures |

#### Project Management Intelligence

| Skill | Description |
|---|---|
| `/sia-pm-sprint-summary` | Sprint summary in plain language for PMs |
| `/sia-pm-decision-log` | Chronological decision log with rationale |
| `/sia-pm-risk-dashboard` | Technical risk dashboard scored by impact |

### Subagents (26 agents)

| Agent | Purpose | Category |
|---|---|---|
| **Before Coding** | | |
| `sia-orientation` | Quick architecture Q&A — single focused answers | Onboarding |
| `sia-onboarding` | Comprehensive multi-topic onboarding session | Onboarding |
| `sia-decision-reviewer` | Decision archaeology — past choices and rejected alternatives | Planning |
| `sia-explain` | Explains SIA's tools, graph structure, and workflows | Meta |
| `sia-search-debugger` | Diagnoses empty / off-target `sia_search` results | Diagnostic |
| `sia-doc-writer` | Generates ADRs / README sections from Decisions + Conventions | Documentation |
| **During Coding** | | |
| `sia-feature` | Feature dev with convention awareness and dependency context | Development |
| `sia-refactor` | Impact analysis via dependency graph before structural changes | Development |
| `sia-convention-enforcer` | Convention compliance check against known standards | Quality |
| `sia-test-advisor` | Test strategy from past failures and known edge cases | Testing |
| `sia-dependency-tracker` | Cross-repo dependency monitoring and API contract tracking | Architecture |
| **During Debugging** | | |
| `sia-debug-specialist` | Active bug investigation with temporal root-cause tracing | Debugging |
| `sia-regression` | Proactive regression risk analysis for code changes | Prevention |
| **During Review** | | |
| `sia-code-reviewer` | Code review with historical context and convention enforcement | Review |
| `sia-security-audit` | Security review with paranoid mode and Tier 4 exposure tracking | Security |
| `sia-conflict-resolver` | Resolve contradicting knowledge entities | Quality |
| **After Coding** | | |
| `sia-knowledge-capture` | Systematic session capture — decisions, conventions, bugs, solutions | Capture |
| `sia-changelog-writer` | Graph-powered changelogs and release notes | Documentation |
| `sia-migration` | Graph maintenance during major refactors | Maintenance |
| **QA & Testing** | | |
| `sia-qa-analyst` | QA intelligence — regression risks, coverage gaps, test recommendations | QA |
| `sia-qa-regression-map` | Scored regression risk map (0-100) per module for test prioritization | QA |
| **Project Management** | | |
| `sia-pm-briefing` | Plain-language project briefings for PMs | PM |
| `sia-pm-risk-advisor` | Technical risk advisor — debt, fragile modules, dependency risks | PM |
| **Tech Lead** | | |
| `sia-lead-architecture-advisor` | Architecture drift detection against captured decisions | Leadership |
| `sia-lead-team-health` | Team knowledge health — coverage gaps, bus-factor risks | Leadership |

All subagents primarily retrieve from the knowledge graph and can run simultaneously.
The feature agent may flag decisions via `sia_flag` when flagging is enabled.
The knowledge-capture agent is designed for end-of-session use rather than parallel execution.
Invoke via `@sia-code-reviewer`, `@sia-orientation`, etc.

### Automatic Hooks

| Hook | Trigger | Purpose |
|---|---|---|
| **PostToolUse** | Write/Edit | Captures knowledge from file changes |
| **PostToolUse** | Bash | Detects branch switches and saves/restores graph snapshots |
| **Stop** | Session stop | Detects uncaptured knowledge patterns |
| **SessionStart** | Session begin | Injects recent decisions/conventions as context |
| **PreCompact** | Before compaction | Scans transcript tail for unextracted knowledge before context compaction |
| **PostCompact** | After compaction | Logs compaction coverage for observability |
| **SessionEnd** | Session exit | Records session statistics and entity counts |
| **UserPromptSubmit** | User prompt | Captures user prompts and detects correction/preference patterns |

## Nous Cognitive Layer

Nous is Sia's cognitive layer — drift monitoring, self-reflection, and anti-sycophancy guardrails. Four always-active hooks (SessionStart drift, PreToolUse significance, PostToolUse discomfort + surprise, Stop episode) run alongside Sia's capture path. Five MCP tools are available for explicit invocation:

| Tool | Purpose |
|---|---|
| `nous_state` | Read drift score, active Preferences, recent signals |
| `nous_reflect` | Self-monitor pass — per-preference alignment + recommended action |
| `nous_curiosity` | Explore under-retrieved, high-trust entities; writes Concerns |
| `nous_concern` | Surface open Concerns weighted by active Preferences |
| `nous_modify` | Create, update, or deprecate Preference nodes (gated, reason required) |

Each tool has a matching slash command — `/nous-state`, `/nous-reflect`, `/nous-curiosity`, `/nous-concern`, `/nous-modify`. See `CLAUDE.md` → "Nous Cognitive Layer — Tool Contract" for authoritative semantics and anti-sycophancy rules.

## Team Sync

SIA supports team knowledge sharing via a self-hosted sqld (libSQL) server.

### Setup

1. DevOps deploys a sqld server (see `TEAM-SYNC-DEPLOYMENT.md`)
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
| `/sia-team` | Join, leave, or check team status (see Skills section above) |
| `/sia-sync` | Manual push/pull operations (see Skills section above) |
| `sia_sync_status` MCP tool | Programmatic sync status check |

## Requirements

- [Bun](https://bun.sh/) runtime installed
- Git repository (for repo identification and change tracking)

## Data Storage

- **Per-project:** Graph database in `~/.sia/repos/{repo-hash}/`
- **Plugin-global:** Configuration and models in `$CLAUDE_PLUGIN_DATA/`
