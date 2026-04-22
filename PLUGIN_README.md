# SIA — Claude Code Plugin (Quick Reference)

Persistent graph memory for AI coding agents. SIA gives Claude Code cross-session memory via a bi-temporal knowledge graph.

This is a **quick-reference card**. For product overview, architecture, and full usage guides, see:

- [README.md](README.md) — product overview, differentiators, quick start
- [CLAUDE.md](CLAUDE.md) — agent behavioural contract loaded every session
- [PLUGIN_USAGE.md](PLUGIN_USAGE.md) — per-skill, per-agent, per-command usage guides
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute, tests, pre-commit
- [SECURITY.md](SECURITY.md) — vulnerability reporting

## Install

```bash
# Marketplace (installs at user scope — available in all projects)
/plugin marketplace add rkarim08/sia
/plugin install sia@sia-plugins
```

For local development (project-scoped): `claude --plugin-dir /path/to/sia`.

## MCP Tools (29)

| Tool | Description |
|---|---|
| `sia_models` | Check transformer model tier status, installed models, and attention head training phase |
| `sia_search` | Semantic search across the Sia knowledge graph |
| `sia_by_file` | Retrieve knowledge graph nodes associated with a file |
| `sia_expand` | Expand an entity's neighbourhood in the knowledge graph |
| `sia_community` | Retrieve community-level summaries from the knowledge graph |
| `sia_at_time` | Query the knowledge graph at a point in time |
| `sia_flag` | Flag current session for human review (writes to session_flags only) |
| `sia_backlinks` | Find all incoming edges (backlinks) to a knowledge graph node |
| `sia_note` | Create a developer-authored knowledge entry in the graph |
| `sia_execute` | Execute code in an isolated sandbox |
| `sia_execute_file` | Execute an existing file in a sandbox subprocess |
| `sia_index` | Index markdown/text content by chunking and scanning for entity references |
| `sia_batch_execute` | Execute multiple operations in one call with precedes edges |
| `sia_fetch_and_index` | Fetch a URL, convert to markdown, and index |
| `sia_stats` | Return graph metrics: node/edge counts by type, optional session stats |
| `sia_doctor` | Run diagnostic checks on the Sia installation |
| `sia_upgrade` | Self-update Sia to the latest version |
| `sia_sync_status` | Check team sync configuration and connection status |
| `sia_ast_query` | Parse a file with tree-sitter and extract symbols, imports, or call relationships |
| `sia_impact` | Analyze the blast radius of a change to a knowledge graph entity |
| `sia_detect_changes` | Detect changed files from git diff and map to knowledge graph entities |
| `sia_snapshot_list` | List all branch-keyed graph snapshots |
| `sia_snapshot_restore` | Restore the knowledge graph from a branch snapshot |
| `sia_snapshot_prune` | Remove branch snapshots for specified branches |
| `nous_state` | Read drift score, active Preferences, recent signals |
| `nous_reflect` | Per-preference alignment breakdown + recommended action |
| `nous_curiosity` | Explore under-retrieved, high-trust entities; writes Concerns |
| `nous_concern` | Surface open Concerns weighted by active Preferences |
| `nous_modify` | Create / update / deprecate Preference nodes (gated, `reason` required) |

## Skills (42)

Skills are slash-invocable workflows that Claude Code can load on demand. For the full table with trigger descriptions and invocation guidance, see
[PLUGIN_USAGE.md → Skills](PLUGIN_USAGE.md#skills-42).

Shortest path for a new user: `/sia-setup` → `/sia-tour` → start working. Sia captures automatically afterwards.

## Agents (26)

Subagents are dispatched via `@sia-<name>`. They run as sub-sessions with their own tool grants. For the full table with *when to dispatch* and categorisation, see
[PLUGIN_USAGE.md → Agents](PLUGIN_USAGE.md#agents-26).

Color palette: **blue** (orient / explain), **green** (generate), **red** (debug / incident), **cyan** (quality / review), **purple** (plan / advise).

## Commands (42)

Pruned from 74 in 1.2.1. Kept: direct MCP wrappers (`/at-time`, `/community`), the five `/nous-*` cognitive-layer commands, args-bearing shims (`/search`, `/learn`), and high-frequency short aliases (`/setup`, `/doctor`, `/capture`, `/debug`, etc.). All other skills and agents remain reachable as `/sia-<name>` and `@sia-<name>`. Phase C1 (Unreleased) folded `/stats`+`/status` into `/health` and added `/pm`, `/qa`, `/export` short aliases for the consolidated skills. See
[PLUGIN_USAGE.md → Commands](PLUGIN_USAGE.md#commands-42) and the 1.2.1 CHANGELOG entry for the full pruning rule.

## Hooks (10 entries across 7 events)

| Event | Purpose |
|---|---|
| PreToolUse | Augment tool calls with graph context; Nous significance signal; `preference-guard` denies Tier-1 "never/do not X" matches |
| PostToolUse | Capture knowledge from file changes; branch-switch snapshots; Nous discomfort + surprise-router (T3 cross-encoder) signals; commit-capture dispatch hint on successful `git commit` |
| Stop | Detect uncaptured knowledge patterns; drift recompute; `SubagentEpisode` write for subagent sessions |
| SessionStart | Inject recent decisions + conventions; Nous drift check |
| PreCompact | Promote staged entities + emit `systemMessage` with top Preferences/Episodes |
| SessionEnd | Staging promotion + `EpisodeSummary` aggregation + mark `nous_sessions.ended_at` |
| UserPromptSubmit | Inject top-k `sia_search` hits + open Concerns as `additionalContext` (≥ 20 char prompts, 200ms timeout) |

Full event matrix and authoring guidance in [hooks/README.md](hooks/README.md).

## Requirements

- [Bun](https://bun.sh/) runtime installed
- Git repository (for repo identification and change tracking)

## Data Storage

- **Per-project:** Graph database in `~/.sia/repos/{repo-hash}/`
- **Plugin-global:** Configuration and models in `$CLAUDE_PLUGIN_DATA/`
