# Sia

**Persistent graph memory for AI coding agents.**

> *Sia was the Egyptian personification of perception, insight, and divine knowledge. She rode on the prow of Ra's solar barque and was said to write knowledge on the heart — the precise act of embedding structured understanding into a store that shapes all future reasoning.*

---

## The Problem

Every time you close a Claude Code session, the agent forgets everything. Decisions made Monday are invisible Friday. Bugs analyzed last week get rediscovered from scratch. Conventions established over days must be re-explained.

Existing workarounds inject flat text into `CLAUDE.md` at session start. This collapses at scale: the file grows unbounded, relationships between facts can't be expressed, stale information competes with current truth, and knowledge stays siloed per developer.

## What Sia Does

Sia captures knowledge from your Claude Code sessions automatically — architectural decisions, bug root causes, coding conventions, and structural dependencies — and stores them in a local, bi-temporal knowledge graph. Between sessions, Claude Code retrieves only what's relevant to the current task via MCP tools.

No explicit input required. No server required. Everything runs locally.

---

## Key Concepts

### Three-Tier Memory

| Tier | Name | Purpose |
|------|------|---------|
| 1 | **Working Memory** | Current session buffer (default 8K token budget) |
| 2 | **Semantic Memory** | Persistent knowledge graph — survives between sessions |
| 3 | **Episodic Memory** | Append-only archive of all interactions — ground truth for re-extraction |

### Bi-Temporal Knowledge Graph

Every fact (entities and edges) carries four timestamps:

- **`t_created`** — when Sia recorded the fact
- **`t_expired`** — when Sia marked it superseded
- **`t_valid_from`** — when the fact became true in the world
- **`t_valid_until`** — when the fact stopped being true (null = still true)

Facts are never deleted — only invalidated. Queries default to "as of now" semantics. You can query the graph at any historical point with `sia_at_time`.

### Entity Types

| Type | Represents |
|------|-----------|
| **CodeEntity** | Functions, classes, files, modules — from AST analysis |
| **Concept** | Architectural ideas, patterns, abstractions |
| **Decision** | Explicit choices with rationale and alternatives |
| **Bug** | Defects with symptoms, root cause, and affected code |
| **Solution** | Fixes and workarounds, linked to bugs they resolve |
| **Convention** | Project-specific rules about naming, style, testing |
| **Community** | Auto-discovered entity clusters from Leiden detection |

### Trust Tiers

| Tier | Source | Default Confidence |
|------|--------|--------------------|
| 1 | User-Direct | 0.95 |
| 2 | Code-Analysis (AST) | 0.92 |
| 3 | LLM-Inferred | 0.70 |
| 4 | External | 0.50 |

### Language Support

Sia uses Tree-sitter for deterministic structural extraction with an extensible language registry.

**Tier A — Full extraction:** TypeScript, TSX, JavaScript, JSX, Python, Go, Rust, Java, Kotlin, Swift, PHP, Ruby, Scala, Elixir, Dart

**Tier B — Structural extraction:** C, C++, C#, Bash/Shell, Lua, Zig, Perl, R, OCaml, Haskell

**Tier C — Schema extraction:** SQL (tables, columns, FKs, indexes), Prisma schema

**Tier D — Manifest extraction:** `Cargo.toml`, `go.mod`, `pyproject.toml`, `.csproj`/`.sln`, `build.gradle`/`pom.xml`

Additional languages can be registered at runtime via `config.json` without modifying source code.

---

## Installation

```bash
npx sia install
```

Installs in under three minutes. No knowledge of graph databases or embedding models required.

---

## MCP Tools

Sia exposes six tools that Claude Code calls on demand:

| Tool | Purpose |
|------|---------|
| `sia_search` | Hybrid search (vector + BM25 + graph traversal) with task-type boosting |
| `sia_by_file` | File-scoped retrieval — decisions, bugs, patterns for a specific file |
| `sia_expand` | BFS graph traversal from a known entity |
| `sia_community` | Architectural summaries from Leiden community detection |
| `sia_at_time` | Point-in-time query against the bi-temporal graph |
| `sia_flag` | Mid-session capture signal for important moments (opt-in) |

The MCP server is read-only against the main graph. The agent behavioral contract governing tool usage is auto-generated into `CLAUDE.md` by `npx sia install`.

---

## Multi-Repo Workspaces

Sia supports three repository models:

- **Single repo** — isolated SQLite database per repository
- **Workspace** — named group of related repos with cross-repo edges stored in a shared `bridge.db`
- **Monorepo** — auto-detected from package manager config (`pnpm-workspace.yaml`, `package.json` workspaces, `nx.json`, Gradle multi-project), scoped at the package level

```bash
npx sia workspace create "My Fullstack App" --repos ./frontend ./backend
```

Cross-repo relationships are detected from OpenAPI specs, GraphQL schemas, TypeScript project references, `.csproj` references, Cargo workspace members, Go module replace directives, and more.

---

## Team Sharing

By default, Sia is fully local — no network calls, no server. Team sharing is opt-in:

```bash
# One developer starts the sync server (single Docker container)
npx sia server start

# Team members join
npx sia team join <server-url> <token>
```

Three visibility levels: **private** (default, never synced), **team** (synced to all workspace members), **project** (synced to specific workspace members).

Sync uses Hybrid Logical Clocks for eventual consistency. Genuine contradictions are flagged with `conflict_group_id` for team review.

---

## Security

- **Staging area**: Tier 4 (external) content passes through an isolated staging table with three validation layers before reaching the main graph
- **Paranoid search**: `sia_search({ paranoid: true })` excludes all Tier 4 entities from results
- **Paranoid capture**: `paranoidCapture: true` in config quarantines all Tier 4 content at the chunker stage — hard guarantee that no external content enters the graph
- **Audit & rollback**: `npx sia rollback` to inspect and revert suspicious entries
- **Read-only MCP**: The MCP server opens `graph.db` with `OPEN_READONLY`

---

## CLI Commands

```
sia install                          # Install and index the repository
sia search [--paranoid] <query>      # Search the knowledge graph
sia stats                            # Graph status and statistics
sia workspace create|list|add|remove|show
sia server start|stop|status         # Team sync server
sia team join|leave|status           # Join/leave a team
sia share <entity-id>                # Promote entity visibility
sia conflicts list|resolve           # Manage conflicting facts
sia prune                            # Clean up the graph
sia export / import                  # Portable graph import/export
sia rollback                         # Inspect and revert entries
sia reindex                          # Re-parse the AST backbone
sia community                        # View community summaries
sia download-model                   # Download the ONNX embedding model
sia enable-flagging / disable-flagging
```

---

## Architecture

Sia is composed of eight modules: storage, capture pipeline, community engine, retrieval engine, MCP server, security layer, decay engine, and team sync.

**Write path**: Hook fires → dual-track extraction (AST + LLM) → two-phase consolidation (ADD/UPDATE/INVALIDATE/NOOP) → atomic graph write

**Read path**: MCP query → three-stage retrieval (vector + BM25 + graph traversal) → RRF reranking → context assembly

For the full architecture with module details, data flow diagrams, schema design, and key algorithms, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Storage

All data lives in `~/.sia/`:

| File | Purpose |
|------|---------|
| `repos/<hash>/graph.db` | Per-repo semantic graph |
| `repos/<hash>/episodic.db` | Per-repo interaction archive |
| `meta.db` | Workspaces and sharing rules |
| `bridge.db` | Cross-repo edges |
| `config.json` | User configuration |

---

## Non-Functional Targets

- Hybrid search: <800ms for graphs up to 50K nodes
- Incremental AST re-parse: <200ms per file
- Full capture pipeline: <8s after hook fires
- Workspace search: <1.2s for two 25K-node repos
- Per-repo storage: <1GB for 50K nodes
- Episodic archive: <2GB for 12 months of daily use

---

## Compatibility

- **OS**: macOS, Linux, Windows (WSL2)
- **Runtime**: Node.js 18+, Bun 1.0+
- **Transport**: Standard MCP stdio

---

## Status

Sia is under active development.

---

## License

TBD
