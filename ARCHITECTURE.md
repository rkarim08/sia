# Architecture

This document describes how Sia is designed and how its components work together. For installation and usage, see the [README](README.md).

---

## Table of Contents

- [System Overview](#system-overview)
- [Module Map](#module-map)
- [Data Flow](#data-flow)
- [Module 1 — Multi-Tier Storage](#module-1--multi-tier-storage)
  - [Database Layout](#database-layout)
  - [Three Memory Tiers](#three-memory-tiers)
  - [Bi-Temporal Model](#bi-temporal-model)
  - [Database Schemas](#database-schemas)
  - [The SiaDb Adapter](#the-siadb-adapter)
  - [Cross-Repo Queries via ATTACH](#cross-repo-queries-via-attach)
  - [Monorepo Support](#monorepo-support)
- [Module 2 — Dual-Track Capture Pipeline](#module-2--dual-track-capture-pipeline)
  - [Track A — Deterministic (NLP/AST)](#track-a--deterministic-nlpast)
  - [Track B — Probabilistic (LLM)](#track-b--probabilistic-llm)
  - [Two-Phase Consolidation](#two-phase-consolidation)
  - [Event Node Creation](#event-node-creation)
  - [Cross-Repo Edge Detection](#cross-repo-edge-detection)
- [Module 3 — Community & Summarization Engine](#module-3--community--summarization-engine)
- [Module 4 — Hybrid Retrieval Engine](#module-4--hybrid-retrieval-engine)
- [Module 5 — MCP Server](#module-5--mcp-server)
- [Module 6 — Security Layer](#module-6--security-layer)
- [Module 7 — Decay & Lifecycle Engine](#module-7--decay--lifecycle-engine)
- [Module 8 — Team Sync Layer](#module-8--team-sync-layer)
- [Module 9 — Sandbox Execution Engine](#module-9--sandbox-execution-engine)
- [Module 10 — Ontology Constraint Layer](#module-10--ontology-constraint-layer)
- [Module 11 — Knowledge & Documentation Engine](#module-11--knowledge--documentation-engine)
- [Module 12 — Five-Layer Freshness Engine](#module-12--five-layer-freshness-engine)
- [Module 13 — Native Performance Module](#module-13--native-performance-module)
- [Module 14 — Hooks-First Capture Engine](#module-14--hooks-first-capture-engine)
- [Module 15 — Pluggable LLM Provider](#module-15--pluggable-llm-provider)
- [Agent Behavioral Layer (CLAUDE.md)](#agent-behavioral-layer-claudemd)
- [Directory Layout](#directory-layout)
- [Key Design Decisions](#key-design-decisions)
- [Air-Gapped Mode](#air-gapped-mode)
- [Configuration Reference](#configuration-reference)

---

## System Overview

Sia is composed of fifteen runtime modules plus an agent behavioral layer. Data flows in one direction through the **write path** (hook → event node creation → capture → staging → consolidation → ontology validation → graph) and one direction through the **read path** (MCP query → retrieval → progressive throttling → context assembly → response). The MCP server is strictly read-only on the main graph, with dedicated write connections for event nodes, session flags, and session resume data.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Claude Code                                 │
│  ┌────────────────────────┐      ┌──────────────────────────────────────┐│
│  │   Hooks System         │      │   MCP Client                         ││
│  │   PostToolUse / Stop / │      │   sia_search, sia_by_file,           ││
│  │   UserPromptSubmit /   │      │   sia_expand, sia_community,         ││
│  │   PreCompact /         │      │   sia_at_time, sia_flag, sia_note,   ││
│  │   SessionStart         │      │   sia_backlinks, sia_execute,        ││
│  └──────────┬─────────────┘      │   sia_execute_file, sia_batch_execute││
│             │ hook payload        │   sia_index, sia_fetch_and_index,   ││
│             │                     │   sia_stats, sia_doctor, sia_upgrade││
└────────────┬────────────────────────────────────────┬───────────────────┘
             │                                        │ MCP stdio
             ▼                                        ▼
┌────────────────────────┐        ┌───────────────────────────────────────┐
│  Module 2 — Capture    │        │  Module 5 — MCP Server                │
│  Track A: NLP/AST      │        │  Read-only on main graph              │
│  Track B: LLM (Haiku)  │        │  Write: event nodes, session_flags,   │
│  Event node creation   │        │         session_resume (WAL mode)     │
│  2-Phase Consolidation │        └──────────────────┬────────────────────┘
│  Ontology validation   │                           │ read via SiaDb
└──────────┬─────────────┘                           ▼
           │ writes via SiaDb      ┌─────────────────────────────────────┐
           ▼                       │  Module 9 — Sandbox Execution       │
┌──────────────────────────────────│  Isolated subprocess per language   │
│                    Module 1 —    │  Context Mode: chunk + embed + index│
│                    Multi-Tier    │  Credential passthrough             │
│                    Storage       └─────────────────────────────────────┘
│                                                                         │
│  ~/.sia/meta.db       — workspace registry, sharing rules, API contracts│
│  ~/.sia/bridge.db     — cross-repo edges (ATTACH on demand)             │
│  ~/.sia/repos/<hash>/                                                   │
│    graph.db           — unified graph (nodes, edges, ontology,         │
│                         communities, staging, flags, audit, resume)     │
│    episodic.db        — append-only interaction archive                 │
│                                                                         │
│  SiaDb adapter wraps bun:sqlite and @libsql/client behind one API       │
└─────────────────────────────────────────────────────────────────────────┘
           │ optional sync
           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Module 8 — Team Sync (disabled by default)                             │
│  @libsql/client embedded replica → self-hosted sqld server              │
│  HLC timestamps · post-sync VSS refresh · bi-temporal conflict flagging │
└─────────────────────────────────────────────────────────────────────────┘

Background processes (non-blocking):
  Module 3  — Community & RAPTOR Engine
  Module 6  — Security Layer (staging promotion)
  Module 7  — Decay & Lifecycle Engine
  Module 10 — Ontology Constraint Layer (validation on every write)
  Module 11 — Knowledge & Documentation Engine (discovery, ingestion, freshness)
  Module 12 — Five-Layer Freshness Engine (invalidation + decay + validation)
  Module 13 — Native Performance Module (optional Rust acceleration)
  Module 14 — Hooks-First Capture Engine (real-time extraction via hook events)
  Module 15 — Pluggable LLM Provider (offline operations + non-Claude-Code agents)

Agent behavioral layer (not a runtime module — injected at session start):
  CLAUDE.md — auto-generated by `npx sia install`
  Governs when Claude Code calls the 16 MCP tools, how it interprets
  results, and what behavioral invariants it enforces.
```

---

## Module Map

| # | Module | Responsibility | Key Files |
|---|--------|----------------|-----------|
| 1 | **Multi-Tier Storage** | SQLite databases, SiaDb adapter, schema management | `src/graph/` |
| 2 | **Dual-Track Capture** | Hook handling, AST/NLP extraction, LLM extraction, event nodes, consolidation | `src/capture/`, `src/ast/` |
| 3 | **Community Engine** | Leiden detection, RAPTOR summary tree, community summaries | `src/community/` |
| 4 | **Hybrid Retrieval** | Vector search, BM25, graph traversal, RRF reranking, progressive throttling | `src/retrieval/` |
| 5 | **MCP Server** | Read-only tool endpoints, event node writes, session flag writes, session resume | `src/mcp/` |
| 6 | **Security Layer** | Staging area, write guards, pattern detection, Rule of Two | `src/security/` |
| 7 | **Decay & Lifecycle** | Importance decay, archival, maintenance sweep (startup catchup + idle) | `src/decay/` |
| 8 | **Team Sync** | HLC timestamps, libSQL replication, conflict resolution | `src/sync/` |
| 9 | **Sandbox Execution** | Isolated subprocess spawning, Context Mode, credential passthrough | `src/sandbox/` |
| 10 | **Ontology Layer** | Edge constraint validation, typed factories, co-creation/cardinality enforcement | `src/ontology/` |
| 11 | **Knowledge Engine** | Documentation discovery, chunking, ingestion, freshness tracking, templates | `src/knowledge/` |
| 12 | **Freshness Engine** | Inverted dependency index, file-watcher invalidation, git-reconcile, stale-while-revalidate, confidence decay, deep validation, dirty propagation | `src/freshness/` |
| 13 | **Native Performance** | Optional Rust NAPI-RS module for AST diffing, graph algorithms, Leiden community detection | `src/native/`, `sia-native/` |
| 14 | **Hooks-First Capture** | Hook event router, PostToolUse extractor, Stop processor, session lifecycle handlers, cross-agent adapters | `src/hooks/` |
| 15 | **Pluggable LLM Provider** | Vercel AI SDK provider registry, Zod schemas, fallback chain, circuit breaker, cost tracking | `src/llm/` |

---

## Data Flow

### Write Path (Capture)

```
Hook fires (PostToolUse / Stop / UserPromptSubmit / PreCompact / SessionStart)
    │
    ├─ Parse payload → resolve repo hash from cwd → open SiaDb
    ├─ Create event node for hook event (EditEvent, GitEvent, ExecutionEvent, etc.)
    │     → part_of edge to SessionNode
    │     → precedes edge to previous event
    │     → kind-specific edges (modifies → FileNode, triggered_by → ExecutionEvent, etc.)
    ├─ Assign trust tier (1–4) to each chunk:
    │     conversation / project code → Tier 2-3
    │     external URLs / unfamiliar paths → Tier 4
    │     user direct statements → Tier 1
    │     developer-authored documentation → Tier 1
    ├─ If paranoidCapture: quarantine ALL Tier 4 chunks immediately
    ├─ Write ALL chunks to episodic.db (unconditional, before any LLM calls)
    │
    ├──────────────────────┐
    ▼                      ▼
Track A (NLP/AST)    Track B (LLM/Haiku)
Deterministic          Probabilistic
~0ms per file          semantic extraction
Creates CodeSymbol,    Creates Decision,
FileNode, PackageNode  Convention, Bug,
with structural edges  Solution, Concept
    │                      │
    └──────────┬───────────┘
               ▼
    Union CandidateFact[]
               │
    ┌──────────┴───────────┐
    ▼                      ▼
Tier 1–3               Tier 4
→ Ontology validation  → memory_staging
→ 2-phase                (pattern detection +
  consolidation          semantic consistency +
→ Edge inference +       confidence threshold +
  pertains_to edges      Rule of Two)
→ Atomic batch write
→ Audit log
               │
               ▼
    Process session_flags (if enableFlagging=true)
    Mark session in sessions_processed
    Trigger community update if new_nodes > threshold
    If sync enabled: push team-visibility nodes + bridge edges
               │
               ▼
    Exit (must complete in < 8 seconds total)
```

### Session Continuity Path

```
PreCompact hook fires (context about to be compacted)
    │
    ├─ Traverse SessionNode → part_of → events
    ├─ Sort events by priority_tier (P1 first: errors, user decisions)
    ├─ Serialize nodes + edges in order until 2 KB budget
    ├─ Store in session_resume table
    │
    ... context compaction occurs ...
    │
SessionStart hook fires (new or resumed session)
    │
    ├─ Load subgraph from session_resume
    ├─ Re-query graph for current state of serialized nodes
    ├─ Build Session Guide via 15 subgraph queries:
    │     last prompt, active tasks, modified files,
    │     unresolved errors, key decisions, relevant conventions
    ├─ Inject session_knowledge directive into context
    └─ Files modified after snapshot show updated state
```

### Read Path (Retrieval)

```
MCP tool call (e.g. sia_search)
    │
    ├─ Validate input (Zod schema)
    ├─ Check progressive throttle (search_throttle table)
    │     Normal (1–3 calls) / Reduced (4–8) / Blocked (9+)
    ├─ Open graph.db read-only via SiaDb
    │
    ▼
Stage 1 — Candidate Generation (parallel)
    ├─ Vector: ONNX embed query → sqlite-vss cosine similarity
    │         (two-stage: B-tree filter on kind/importance, then VSS)
    ├─ BM25: FTS5 MATCH with normalized rank
    │         (filtered to t_valid_until IS NULL)
    └─ Graph: node name lookup → 1-hop expansion
              (root score 1.0, neighbors 0.7)
    │
    ▼
Stage 2 — Graph-Aware Expansion
    For each candidate, fetch direct neighbors not in candidate set
    Score at candidate score × 0.7
    │
    ▼
Stage 3 — RRF Reranking
    final_score = rrf_score × importance × confidence
                  × trust_weight × (1 + task_boost × 0.3)
    │
    ▼
Response Budget Enforcement
    maxResponseTokens: whole nodes or nothing, truncated flag
    │
    ▼
Context Assembly → JSON response to Claude Code
```

---

## Module 1 — Multi-Tier Storage

### Database Layout

```
~/.sia/
  meta.db                               # workspace/repo registry, sharing rules,
                                        # API contracts, sync config, sync peers
  bridge.db                             # cross-repo edges (workspace members only)
  config.json                           # user configuration
  repos/
    <sha256-of-absolute-path>/
      graph.db                          # per-repo: unified graph
      episodic.db                       # per-repo: episodic archive
  models/
    all-MiniLM-L6-v2.onnx              # local embedding model (~90MB)
  ast-cache/
    <sha256-of-absolute-path>/          # per-repo: Tree-sitter parse cache
      <file-relative-path>.cache        # keyed by file path + mtime
  snapshots/
    <repo-hash>/YYYY-MM-DD.snapshot     # daily graph snapshots
  server/
    docker-compose.yml                  # written by 'npx sia server start'
  logs/
    sia.log                             # structured JSON log
```

The `sha256-of-absolute-path` is derived from the **resolved** absolute path of the repository root (symlinks expanded). Each repository gets its own isolated database. Repositories never share node IDs or edges unless explicitly linked via a workspace.

### Three Memory Tiers

| Tier | Store | Persistence | Purpose |
|------|-------|-------------|---------|
| **Working Memory** | In-process buffer | Session only | Current context (configurable 8K token budget) |
| **Semantic Memory** | `graph.db` | Permanent | Knowledge graph — nodes, edges, communities, summaries |
| **Episodic Memory** | `episodic.db` | Permanent | Append-only archive of all interactions — ground truth |

When the working memory budget fills, a PreCompact hook fires: the current session's priority-weighted subgraph is serialized to `session_resume`, and working memory resets. On SessionStart, the subgraph is deserialized and the Session Guide is injected.

### Bi-Temporal Model

Both nodes and edges carry four temporal columns. This is the core mechanism that distinguishes Sia from flat memory systems.

| Column | Meaning | Set By |
|--------|---------|--------|
| `t_created` | When Sia recorded this fact | INSERT time |
| `t_expired` | When Sia marked it superseded | `invalidateNode()` / `invalidateEdge()` |
| `t_valid_from` | When the fact became true in the world | Extraction (may be null if unknown) |
| `t_valid_until` | When the fact stopped being true | `invalidateNode()` / `invalidateEdge()` |

Facts are never hard-deleted. Invalidation sets `t_valid_until`. Normal queries filter to `WHERE t_valid_until IS NULL`. The `sia_at_time` tool adjusts these filters to query the graph at any historical point.

**Important distinction:** `t_valid_until` (temporal invalidation) is for superseded facts. `archived_at` (lifecycle archival) is for decayed, disconnected nodes. A superseded Decision node is invalidated, not archived — it remains queryable via `sia_at_time` as historical record.

### Database Schemas

#### graph.db (per-repo) — Core Tables

**`graph_nodes`** — The unified node store with `kind` discriminator:

```sql
CREATE TABLE graph_nodes (
  id               TEXT PRIMARY KEY,      -- UUID v4
  kind             TEXT NOT NULL,         -- CodeSymbol|FileNode|PackageNode|
                                          -- Concept|Decision|Bug|Solution|Convention|Community|
                                          -- ContentChunk|SessionNode|EditEvent|ExecutionEvent|
                                          -- SearchEvent|GitEvent|ErrorEvent|UserDecision|
                                          -- UserPrompt|TaskNode|ExternalRef
  name             TEXT NOT NULL,
  content          TEXT NOT NULL,         -- Full description (max ~500 words)
  summary          TEXT NOT NULL,         -- One sentence (max 20 words)
  package_path     TEXT,                  -- Monorepo scoping (NULL for standalone repos)
  tags             TEXT NOT NULL DEFAULT '[]',
  file_paths       TEXT NOT NULL DEFAULT '[]',
  trust_tier       INTEGER NOT NULL DEFAULT 3,
  confidence       REAL NOT NULL DEFAULT 0.7,
  importance       REAL NOT NULL DEFAULT 0.5,
  priority_tier    INTEGER,              -- P1–P4 for event nodes (used by session continuity)
  access_count     INTEGER NOT NULL DEFAULT 0,
  edge_count       INTEGER NOT NULL DEFAULT 0,   -- denormalized; maintained by 4 triggers
  session_id       TEXT,                 -- links event nodes to their session
  properties       TEXT,                 -- JSON: template fields, git metadata, freshness data
  -- Bi-temporal metadata
  t_created        INTEGER NOT NULL,
  t_expired        INTEGER,
  t_valid_from     INTEGER,
  t_valid_until    INTEGER,
  -- Team visibility
  visibility       TEXT NOT NULL DEFAULT 'private',
  created_by       TEXT NOT NULL,
  conflict_group_id TEXT,               -- non-null = contradicting facts exist
  -- Provenance
  extraction_method TEXT,               -- tree-sitter|llm-haiku|user-direct|manifest|document-ingest
  embedding        BLOB,               -- 384-dim from all-MiniLM-L6-v2
  archived_at      INTEGER             -- soft delete for decayed nodes only
  -- ... plus HLC sync columns, base scores, workspace scope
);
```

**`graph_edges`** — Typed, weighted, bi-temporal relationships with ontology enforcement:

```sql
CREATE TABLE graph_edges (
  id            TEXT PRIMARY KEY,
  from_id       TEXT NOT NULL REFERENCES graph_nodes(id),
  to_id         TEXT NOT NULL REFERENCES graph_nodes(id),
  type          TEXT NOT NULL,
    -- Structural (AST): defines|imports|calls|inherits_from|contains|depends_on
    -- Semantic (LLM):   pertains_to|solves|caused_by|supersedes|elaborates|contradicts|references
    -- Event:            modifies|triggered_by|produced_by|resolves|during_task|precedes
    -- Session:          part_of|continued_from
    -- Community:        member_of|summarized_by
    -- Documentation:    child_of|references
  weight        REAL NOT NULL DEFAULT 1.0,
  confidence    REAL NOT NULL DEFAULT 0.7,
  trust_tier    INTEGER NOT NULL DEFAULT 3,
  t_created     INTEGER NOT NULL,
  t_expired     INTEGER,
  t_valid_from  INTEGER,
  t_valid_until INTEGER
);
```

**`edge_constraints`** — Ontology declaration (all valid relationship triples):

```sql
CREATE TABLE edge_constraints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind TEXT NOT NULL,
  edge_type   TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  description TEXT,
  cardinality TEXT DEFAULT 'many-to-many',
  required    INTEGER DEFAULT 0,
  UNIQUE(source_kind, edge_type, target_kind)
);
```

**Edge count maintenance triggers** (4 triggers):
- INSERT active edge → count increments on both endpoints
- Invalidate edge (set `t_valid_until`) → decrements
- Reactivate edge (clear `t_valid_until`) → increments back
- DELETE active edge → decrements (hard-delete trigger)

**Ontology validation triggers:**
- `validate_edge_ontology` — BEFORE INSERT on `graph_edges`: rejects any edge where `(source_kind, edge_type, target_kind)` is not in `edge_constraints`
- `validate_supersedes_same_kind` — BEFORE INSERT: `supersedes` edges must connect same-kind nodes
- `guard_convention_pertains_to` — BEFORE DELETE: prevents removing a Convention's last `pertains_to` edge

**FTS5 sync triggers** (3 triggers: AI, AD, AU) keep `graph_nodes_fts` in sync with `graph_nodes`.

**`memory_staging`** — Isolated staging for external content (no FKs to main graph):

```sql
CREATE TABLE memory_staging (
  id                   TEXT PRIMARY KEY,
  proposed_kind        TEXT NOT NULL,
  proposed_name        TEXT NOT NULL,
  proposed_content     TEXT NOT NULL,
  trust_tier           INTEGER NOT NULL DEFAULT 4,
  raw_confidence       REAL NOT NULL,
  validation_status    TEXT NOT NULL DEFAULT 'pending',  -- pending|passed|rejected|quarantined
  rejection_reason     TEXT,
  created_at           INTEGER NOT NULL,
  expires_at           INTEGER NOT NULL                  -- 7-day TTL
);
```

**`session_resume`** — Session continuity subgraph storage:

```sql
CREATE TABLE session_resume (
  session_id   TEXT PRIMARY KEY,
  subgraph     TEXT NOT NULL,             -- JSON: serialized nodes + edges
  last_prompt  TEXT,
  budget_used  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
```

**`source_deps`** — Inverted dependency index mapping source files to derived graph nodes:

```sql
CREATE TABLE source_deps (
  source_path  TEXT NOT NULL,     -- relative path from repo root
  node_id      TEXT NOT NULL REFERENCES graph_nodes(id),
  dep_type     TEXT NOT NULL,     -- 'defines' | 'extracted_from' | 'pertains_to' | 'references'
  source_mtime INTEGER NOT NULL,  -- file mtime at time of extraction (Unix ms)
  PRIMARY KEY (source_path, node_id)
);
```

**`current_nodes`** — Shadow table maintained by triggers, containing only active non-archived nodes. Eliminates the `WHERE t_valid_until IS NULL AND archived_at IS NULL` predicate from the most common query pattern, reducing effective table size by ~10× for graphs where 90% of rows are historical versions:

```sql
CREATE TABLE current_nodes AS
  SELECT * FROM graph_nodes
  WHERE t_valid_until IS NULL AND archived_at IS NULL;
```

**Supporting tables:**
- `graph_nodes_fts` — FTS5 virtual table for BM25 keyword search (synced via triggers)
- `graph_nodes_vss` — sqlite-vss virtual table for 384-dim vector search (local only, never synced)
- `communities` / `community_members` — Leiden cluster membership and summaries
- `summary_tree` — RAPTOR multi-level summaries
- `source_deps` — Inverted dependency index (source file → derived graph nodes)
- `current_nodes` — Shadow table of active, non-archived nodes (trigger-maintained)
- `session_flags` — Mid-session capture signals
- `sessions_processed` — Tracks which sessions have been extracted
- `search_throttle` — Progressive throttling: call count per session
- `audit_log` — Every write operation (ADD/UPDATE/INVALIDATE/STAGE/PROMOTE/QUARANTINE/...)
- `local_dedup_log` — Maintenance consolidation sweep tracking
- `sync_dedup_log` — Post-sync deduplication tracking (separate table, separate process)

#### meta.db — Workspace Registry

```sql
-- Repository registry
CREATE TABLE repos (
  id TEXT PRIMARY KEY,              -- sha256 of resolved absolute path
  path TEXT NOT NULL UNIQUE,
  detected_type TEXT                -- standalone|monorepo_root|monorepo_package
);

-- Named workspaces
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,              -- UUID v4
  name TEXT NOT NULL UNIQUE
);

-- Workspace membership
CREATE TABLE workspace_repos (
  workspace_id TEXT REFERENCES workspaces(id),
  repo_id TEXT REFERENCES repos(id),
  PRIMARY KEY (workspace_id, repo_id)
);

-- Auto-detected API contracts between repos
CREATE TABLE api_contracts (
  id TEXT PRIMARY KEY,
  provider_repo_id TEXT REFERENCES repos(id),
  consumer_repo_id TEXT REFERENCES repos(id),
  contract_type TEXT NOT NULL,      -- openapi|graphql|trpc|grpc|npm-package|ts-reference|
                                    -- csproj-reference|cargo-dependency|go-mod-replace|...
  spec_path TEXT,
  trust_tier INTEGER DEFAULT 2
);

-- Sharing rules (workspace-wide, not per-repo)
CREATE TABLE sharing_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  entity_type TEXT,                 -- NULL = all types
  default_visibility TEXT NOT NULL  -- private|team|project
);

-- Team sync configuration
CREATE TABLE sync_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  server_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  developer_id TEXT,
  last_sync_at INTEGER
);

-- Known teammate devices
CREATE TABLE sync_peers (
  peer_id TEXT PRIMARY KEY,
  display_name TEXT,
  last_seen_hlc INTEGER,
  last_seen_at INTEGER
);
```

#### bridge.db — Cross-Repo Edges

```sql
CREATE TABLE cross_repo_edges (
  id TEXT PRIMARY KEY,
  source_repo_id TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  target_repo_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  type TEXT NOT NULL,               -- calls_api|depends_on|shares_type|references
  weight REAL NOT NULL DEFAULT 1.0,
  -- Full bi-temporal metadata (matches per-repo edges)
  t_created INTEGER NOT NULL,
  t_valid_from INTEGER,
  t_valid_until INTEGER
);
```

#### episodic.db — Interaction Archive

```sql
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,               -- conversation|tool_use|file_read|command
  role TEXT,                        -- user|assistant|tool
  content TEXT NOT NULL,
  tool_name TEXT,
  file_path TEXT,
  trust_tier INTEGER NOT NULL DEFAULT 3
);

-- Tracks which sessions have been extracted
CREATE TABLE sessions_processed (
  session_id TEXT PRIMARY KEY,
  processing_status TEXT NOT NULL DEFAULT 'complete',  -- complete|partial|failed
  entity_count INTEGER NOT NULL DEFAULT 0
);
```

### The SiaDb Adapter

The capture pipeline uses `bun:sqlite` (synchronous). The sync layer uses `@libsql/client` (async). These APIs are type-incompatible. The `SiaDb` adapter wraps both behind a single interface so all CRUD code in `src/graph/` is backend-agnostic:

```typescript
interface SiaDb {
  execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  executeMany(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
  transaction(fn: (db: SiaDb) => Promise<void>): Promise<void>;
  close(): Promise<void>;
  rawSqlite(): Database | null;  // for VSS operations; null in libSQL mode
}
```

Two implementations:
- **`BunSqliteDb`** — wraps `bun:sqlite` for local-only mode. `executeMany` is atomic (BEGIN/COMMIT/ROLLBACK). Reentrancy guard on `transaction()`. Nested `transaction()` throws.
- **`LibSqlDb`** — wraps `@libsql/client` for team sync mode (embedded replica). `executeMany` uses `"write"` batch mode.

The `openSiaDb()` router selects the correct implementation at startup:

```typescript
async function openSiaDb(repoHash: string, config: SyncConfig, opts?: { readonly?: boolean }): Promise<SiaDb> {
  if (!config.enabled || !config.serverUrl) {
    return openDb(repoHash, opts);       // local bun:sqlite
  }
  return createSiaDb(repoHash, config);  // libSQL embedded replica
}
```

**VSS operations** (vector search insert/query) always go through `rawSqlite()`. In libSQL mode where `rawSqlite()` returns null, VSS operations are queued and applied during post-sync refresh using a direct bun:sqlite connection.

### Cross-Repo Queries via ATTACH

When a query has `workspace: true`, the retrieval engine ATTACHes `bridge.db` and peer repo databases:

```
SQLite ATTACH limit: 10 databases total
  main (1) + bridge (1) + peer repos (up to 8) = 10
```

If a workspace exceeds 8 repos, queries round-robin through ATTACH/DETACH cycles. Missing peer databases are handled gracefully — results include a `missing_repos` metadata field in the response.

**WAL atomicity note:** WAL-mode transactions are not atomic across attached databases. A cross-repo edge write to `bridge.db` may be briefly inconsistent with the node write to `graph.db` after a crash. The maintenance sweep detects and cleans up dangling references.

### Monorepo Support

Monorepos are auto-detected from package manager configuration in this precedence order:

1. `pnpm-workspace.yaml` → glob patterns under `packages:`
2. `package.json` `"workspaces"` field (yarn / npm)
3. `nx.json` with per-package `project.json` files
4. `settings.gradle` / `settings.gradle.kts` for Gradle multi-project

The presence of `turbo.json` signals a Turborepo project but is **never** used for package path discovery — that always comes from the underlying package manager.

Within a monorepo, all packages share a single `graph.db` scoped by `package_path` on each node.

---

## Module 2 — Dual-Track Capture Pipeline

The capture pipeline runs two parallel extraction tracks and merges their output through two-phase consolidation with ontology validation. The entire pipeline must complete in under 8 seconds.

### Track A — Deterministic (NLP/AST)

Uses Tree-sitter to parse source files through a **declarative language registry** (`src/ast/languages.ts`). Creates `CodeSymbol` nodes with `defines` edges to `FileNode` nodes, plus `imports`, `calls`, `depends_on` edges. The registry is the single source of truth for language support:

```typescript
interface LanguageConfig {
  extensions: string[];
  treeSitterGrammar: string;       // npm package name
  tier: 'A' | 'B' | 'C' | 'D';
  extractors: {
    functions: boolean;
    classes: boolean;
    imports: boolean;
    calls: boolean;
  };
  specialHandling?: 'c-include-paths' | 'csharp-project' | 'sql-schema' | 'prisma-schema' | 'project-manifest';
}
```

The pipeline never contains language-specific switch statements — all dispatch goes through the registry's `specialHandling` field:

| Special Handling | What It Does |
|-----------------|--------------|
| `c-include-paths` | Resolves `#include` via `compile_commands.json` (C/C++) |
| `csharp-project` | Parses `.csproj` `<ProjectReference>` for cross-package edges |
| `sql-schema` | Extracts tables, columns, FKs, indexes as first-class nodes |
| `prisma-schema` | Extracts Prisma models and relations |
| `project-manifest` | Extracts dependency edges from Cargo.toml, go.mod, etc. |

Adding a new language requires only a registry entry — not changes to the extraction pipeline. Users can also register languages at runtime via `config.json`.

### Track B — Probabilistic (LLM)

Sends conversation turns and ambiguous content to Haiku for semantic extraction. Returns typed `CandidateFact[]` with:
- Node kind, name, content, summary
- Tags and file paths
- Confidence score
- Proposed relationships to existing nodes
- `t_valid_from` (if inferable from conversation context)

Candidates below `minExtractConfidence` (default 0.6) are discarded. API failures return an empty array — they never propagate up or block the pipeline.

### Two-Phase Consolidation

For each Tier 1–3 candidate:

1. **Phase 1 — Match:** Retrieve top-5 semantically similar existing nodes
2. **Phase 2 — Decide:** Haiku consolidation call chooses one of four operations:

| Operation | When | Effect |
|-----------|------|--------|
| **NOOP** | Candidate duplicates an existing node | Discarded |
| **UPDATE** | Candidate adds new information to an existing node | Existing node's content merged |
| **INVALIDATE** | Candidate supersedes an existing node | Old node's `t_valid_until` AND `t_expired` set; new node inserted |
| **ADD** | Candidate is genuinely new knowledge | New node inserted |

All edges are validated against the ontology constraint layer (Module 10) before commit. Target compression: ≥80% of raw candidates result in NOOP or UPDATE (the graph stays compact). All writes are batched into a single SiaDb transaction.

### Edge Inference with `pertains_to`

After consolidation, the edge inferrer creates `pertains_to` edges connecting semantic nodes (Decision, Convention, Bug, Solution, Concept) to the specific `CodeSymbol` and `FileNode` nodes they concern. This replaces legacy `file_paths` JSON arrays with structural graph connections, making relationships traversable and queryable.

### Event Node Creation

Every hook event creates a typed event node in the graph:

| Hook Event | Node Kind | Key Edges |
|------------|-----------|-----------|
| File edit | `EditEvent` | `modifies` → FileNode, `part_of` → SessionNode |
| Command execution | `ExecutionEvent` | `produced_by` → ContentChunk, `part_of` → SessionNode |
| Git operation | `GitEvent` | `references` → FileNode, `part_of` → SessionNode |
| Error encountered | `ErrorEvent` | `triggered_by` → ExecutionEvent, `part_of` → SessionNode |
| User correction | `UserDecision` | `references` → CodeSymbol/FileNode/Decision |
| User message | `UserPrompt` | `part_of` → SessionNode |

Events within a session are linked by `precedes` edges, forming a causal chain. This enables temporal narrative queries: "What happened before this error?"

### Cross-Repo Edge Detection

After Track A extraction, the pipeline checks `api_contracts` in `meta.db` for contracts where the current repo is a consumer. Detected cross-repo edges are written to `bridge.db`, not `graph.db`.

---

## Module 3 — Community & Summarization Engine

### Leiden Community Detection

Discovers clusters of related nodes at three hierarchy levels using composite edge weights:

| Signal | Weight | Source |
|--------|--------|--------|
| Structural AST dependencies | 0.5 | Tree-sitter extraction |
| Conversation co-occurrence | 0.3 | Episodic archive |
| Git co-change | 0.2 | Git log analysis |

Three resolution levels:
- **Level 0** (fine, resolution 2.0) — individual component clusters
- **Level 1** (medium, resolution 1.0) — module-level groupings
- **Level 2** (coarse, resolution 0.5) — architectural subsystems

Detection triggers after 20 new nodes since last run (configurable). Minimum graph size: 100 nodes. For monorepos, detection runs per-package first, then whole-repo for higher levels.

### Summary Cache Invalidation

Summaries are cached by SHA-256 of sorted member node IDs. Each community tracks `last_summary_member_count`. After each Leiden run, if membership changes by >20%, the summary is invalidated and regenerated. This ensures summaries reflect the current graph state without expensive regeneration on every change.

### RAPTOR Summary Tree

Multi-granularity retrieval through four levels of abstraction:

| Level | Scope | Generated | Purpose |
|-------|-------|-----------|---------|
| 0 | Raw node content | On write | Direct fact retrieval |
| 1 | Per-node paragraph summaries | Lazy | Concise node descriptions |
| 2 | Module/package summaries | With community summaries | Module-level understanding |
| 3 | Architectural overview | Weekly | System-wide orientation |

All stored in `summary_tree` with content-hash invalidation — a summary is regenerated only when its source content changes.

---

## Module 4 — Hybrid Retrieval Engine

Retrieval combines three independent signals via Reciprocal Rank Fusion (RRF).

### Stage 1 — Candidate Generation (parallel)

Three retrieval methods run simultaneously:

**Vector search:** Embed query with local ONNX model (all-MiniLM-L6-v2, 384-dim) → two-stage retrieval:
1. B-tree filter on kind, importance, `t_valid_until IS NULL` (fast, reduces candidate set)
2. sqlite-vss cosine similarity on filtered embeddings

**BM25 keyword search:** FTS5 `MATCH` query across name, content, summary, and tags with normalized rank. Filtered to active nodes.

**Graph traversal:** Extract node names from query string → direct name lookup → 1-hop neighbor expansion. Root nodes score 1.0, immediate neighbors 0.7.

### Stage 2 — Graph-Aware Expansion

For each Stage 1 candidate, fetch direct neighbors not already in the candidate set. Added at score × 0.7. This surfaces related nodes that individual signals might miss.

### Stage 3 — RRF Reranking

```
rrf_score      = Σ 1/(60 + rank_i)     for each signal i ∈ {vector, bm25, graph}

trust_weight   = { 1: 1.00,            # User-Direct: full weight
                   2: 0.90,            # Code-Analysis: 10% discount (code can be ambiguous)
                   3: 0.70,            # LLM-Inferred: 30% discount (probabilistic)
                   4: 0.50 }           # External: 50% discount (untrusted provenance)

task_boost     = 1.0 if node.kind matches boosted kinds for task_type, else 0.0
                 bug-fix  → boost Bug, Solution
                 feature  → boost Concept, Decision
                 review   → boost Convention

final_score    = rrf_score × importance × confidence × trust_weight
                 × (1 + task_boost × 0.3)
```

When `paranoid: true`, all Tier 4 nodes are excluded before Stage 1 even begins.

### Progressive Throttling

Tracks call count per session via `search_throttle` table:
- **Normal (1–3 calls)**: full results
- **Reduced (4–8 calls)**: fewer results + warning message
- **Blocked (9+ calls)**: redirects to `sia_batch_execute`

Reset on new session.

### Query Routing

A keyword-based classifier routes queries to the appropriate mode:
- **Broad queries** ("explain the architecture") → global mode using community summaries
- **Specific queries** ("UserService.authenticate bug") → local mode using the three-stage pipeline
- **Ambiguous queries** → DRIFT-style iterative deepening

Global mode is never invoked below the minimum graph size (100 nodes).

---

## Module 5 — MCP Server

The MCP server exposes 16 tools over stdio transport. It is **strictly read-only** on the main graph.

### Security Model

The MCP server opens `graph.db` and `bridge.db` with SQLite's `OPEN_READONLY` flag, enforced at the OS level. Separate write connections are opened in WAL mode for: event nodes, `session_flags`, and `session_resume`. These are compatible with the readonly reader.

All tool inputs are validated via Zod schemas before any database access. Sync tokens are never exposed in outputs.

### Tool Contracts

#### Memory Tools

**`sia_search`** — Primary retrieval tool

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Natural language query |
| `task_type` | `'bug-fix'` \| `'feature'` \| `'review'` | omit | Boosts relevant node kinds |
| `node_types` | string[] | all | Filter by node kind |
| `package_path` | string | all | Monorepo package scoping |
| `workspace` | boolean | false | Include cross-repo results (adds ~400ms) |
| `paranoid` | boolean | false | Exclude all Tier 4 nodes |
| `limit` | number | 5 (max 15) | Result count |
| `include_provenance` | boolean | false | Add `extraction_method` to results |

Output: `SiaSearchResult[]` — each result includes `conflict_group_id` (non-null = contradiction exists), `t_valid_from`, `t_valid_until`, and optional `extraction_method`. Response budget enforced: `maxResponseTokens` controls how many whole nodes are included; `truncated: true` signals more results available.

**`sia_by_file`** — File-scoped retrieval

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `file_path` | string | required | Relative path from project root |
| `workspace` | boolean | false | Include cross-repo edges for this file |
| `limit` | number | 10 | Result count |

Traverses from FileNode through all connected edges. Returns decisions, conventions, bugs, documentation chunks connected to the file.

**`sia_expand`** — Graph relationship traversal

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `node_id` | string | required | Node to expand from |
| `depth` | 1 \| 2 \| 3 | 1 | Hop count (90% of cases use 1) |
| `edge_types` | string[] | all | Filter edge types |
| `include_cross_repo` | boolean | false | Include bridge.db edges |

Output: `SiaExpandResult` — center node + up to 50 neighbors + up to 200 edges. `edge_count` reports the total before truncation.

**`sia_community`** — Architectural summaries

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | - | Topic for community selection |
| `node_id` | string | - | OR: get community containing this node |
| `level` | 0 \| 1 \| 2 | 1 | Granularity (0=fine, 1=module, 2=architectural) |
| `package_path` | string | all | Monorepo scoping |

Output: `SiaCommunityResult` wrapper object with `communities[]` and `global_unavailable` flag (set when graph < 100 nodes).

**`sia_at_time`** — Temporal graph query

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `as_of` | string | required | ISO 8601 or relative ("30 days ago", "January") |
| `node_types` | string[] | all | Filter by kind |
| `tags` | string[] | all | Filter by tag |
| `limit` | number | 20 (max 50) | Applies to BOTH nodes[] and invalidated_nodes[] |

Output: `SiaTemporalResult` — `nodes[]` (valid at as_of), `invalidated_nodes[]` (ended by as_of, sorted by `t_valid_until DESC`), `edges[]` (max 50), `invalidated_count` (total before truncation).

**`sia_flag`** — Mid-session capture signal (requires `enableFlagging: true`)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `reason` | string | required | Max 100 chars after sanitization |

**`sia_note`** — Developer-authored knowledge entry

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `kind` | string | required | Decision\|Convention\|Bug\|Solution\|Concept |
| `name` | string | required | Node name |
| `content` | string | required | Full description |
| `tags` | string[] | `[]` | Tags |
| `relates_to` | string[] | `[]` | File paths or node IDs → `pertains_to` edges |
| `template` | string | - | Template name from `.sia/templates/` |
| `properties` | object | - | Template-specific structured fields |
| `supersedes` | string | - | Node ID of the node this one replaces |

Creates a Tier 1 node. Routes through the ontology middleware — co-creation and cardinality constraints are enforced.

**`sia_backlinks`** — Incoming edge traversal

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `node_id` | string | required | Node whose backlinks to query |
| `edge_types` | string[] | all | Filter to specific edge types |

Output: `{ target: SiaSearchResult, backlinks: { [edge_type]: SiaSearchResult[] }, total_count: number }`

#### Sandbox Tools

**`sia_execute`** — Isolated subprocess execution

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `language` | string | auto-detect | Runtime (python, node, bun, bash, ruby, go, rust, java, php, perl, r) |
| `code` | string | required | Code to execute |
| `intent` | string | - | Activates Context Mode for large output |
| `timeout` | number | `sandboxTimeout` | Override timeout (ms) |

When output > `contextModeThreshold` and `intent` is provided: chunks output, embeds each chunk, creates ContentChunk nodes with `produced_by` edges, returns only intent-matching chunks. Credential passthrough: inherits PATH, HOME, AWS_*, GOOGLE_*, GH_TOKEN, etc.

**`sia_execute_file`** — File processing in sandbox

Like `sia_execute` but mounts a file. Raw content never enters agent context.

**`sia_batch_execute`** — Multi-command batch

Execute multiple commands + searches in one call. Creates event nodes with `precedes` edges.

**`sia_index`** — Content indexing

Chunks markdown by headings, creates ContentChunk nodes with embeddings and FTS5 indexing, cross-references to known CodeSymbol/FileNode via `references` edges.

**`sia_fetch_and_index`** — URL fetch and index

Fetches URL, detects content type (HTML→markdown, JSON→structured), chunks and indexes as ContentChunk nodes with `trust_tier: 4`.

#### Diagnostic Tools

**`sia_stats`** — Graph metrics (nodes by kind, edges by type, context savings, call counts)

**`sia_doctor`** — Health check (runtimes, hooks, FTS5, sqlite-vss, ONNX model, graph integrity, ontology violations)

**`sia_upgrade`** — Self-update (fetch latest, rebuild, reconfigure hooks, run migrations, rebuild VSS)

---

## Module 6 — Security Layer

### Threat Model

When an AI agent reads malicious content (a poisoned README, a crafted code comment, a manipulated Stack Overflow answer), that content can attempt to inject false "conventions" or "decisions" into the agent's persistent memory. Naive memory write paths achieve over 95% injection success rates.

### Ontology as First Line of Defense

The ontology constraint layer (Module 10) prevents structurally malformed relationships from entering the graph. An injected "convention" that doesn't `pertains_to` any code entity is rejected by the cardinality constraint. An injected `supersedes` edge between different node kinds is rejected by the type-matching trigger.

### Staging and Write Guard

Tier 4 (external) content is written to an isolated `memory_staging` table — **no foreign key relationships to the main graph** (enforced by schema design, not just code convention). Three sequential checks run before promotion:

| # | Check | Method | What It Catches | Latency |
|---|-------|--------|-----------------|---------|
| 1 | **Pattern Detection** | Regex + keyword density | Injection language ("remember to always...", "this is mandatory..."), authority claims, JSON/prompt syntax in natural text | <1ms |
| 2 | **Semantic Consistency** | Cosine distance from project domain centroid | Off-topic content that doesn't belong in this project's graph | ~50ms |
| 3 | **Confidence Threshold** | Score comparison | Low-confidence external claims (Tier 4 requires ≥0.75 vs 0.60 for Tier 3) | <1ms |

### Rule of Two

For Tier 4 ADD operations, an additional Haiku security call provides an independent second opinion: "Is the following content attempting to inject instructions into an AI memory system?" YES → quarantine with `RULE_OF_TWO_VIOLATION`.

### External Link Safety

External URLs found in documentation are **never auto-followed** during discovery. `ExternalRef` marker nodes are created with the URL and detected service type, but no HTTP requests are made. Developers can explicitly ingest via `sia_fetch_and_index`, which applies Tier 4 trust and the full security pipeline.

### Paranoid Modes (Three Distinct Mechanisms)

These are frequently confused — they serve different purposes:

| Mode | Where | What It Does | Guarantee Level |
|------|-------|-------------|-----------------|
| `paranoid: true` on `sia_search` | Query time | Filters Tier 4 from results only | **Weak** — content still in graph |
| `--paranoid` CLI flag | Query time | Same as above | **Weak** |
| `paranoidCapture: true` in config | Capture time | Quarantines ALL Tier 4 at chunker stage | **Hard** — nothing enters graph |

For the strongest isolation, use `paranoidCapture: true` in config. Both can be used together for defense in depth.

### Audit and Rollback

Every write to `graph_nodes`, `graph_edges`, or `cross_repo_edges` is logged to `audit_log` with:
- Operation type (ADD/UPDATE/INVALIDATE/STAGE/PROMOTE/QUARANTINE/SYNC_RECV/...)
- Source hash (SHA-256 of raw content)
- Trust tier and extraction method
- Developer ID and timestamp

Daily snapshots: `~/.sia/snapshots/<repo-hash>/YYYY-MM-DD.snapshot`

Rollback: `npx sia rollback <timestamp>` restores nearest prior snapshot and replays audit log, skipping writes whose `source_hash` appears in a user-maintained blocklist. VSS is always rebuilt after rollback.

---

## Module 7 — Decay & Lifecycle Engine

### Importance Decay

Every node's importance decays over time based on access patterns, connectivity, and trust:

```
connectivity_boost = min(edge_count × 0.04, 0.25)
access_boost       = min(ln(access_count + 1) / ln(100), 0.20)
trust_boost        = (2 − trust_tier) × 0.05
                     # Tier 1 → +0.05, Tier 2 → 0.00, Tier 3 → −0.05, Tier 4 → −0.10
days_since_access  = (now − last_accessed) / 86_400_000
decay_factor       = 0.5 ^ (days_since_access / half_life_days)

new_importance     = clamp(
                       base_importance × decay_factor
                       + connectivity_boost + access_boost + trust_boost,
                       0.0, 1.0)
```

Half-lives by kind:

| Kind | Half-Life | Rationale |
|------|-----------|-----------|
| Decision | 90 days | Architectural decisions have long relevance |
| Convention | 60 days | Team patterns evolve gradually |
| Bug / Solution | 45 days | Bug context decays as code changes |
| Default (semantic) | 30 days | General knowledge decays faster |
| Event nodes | 1 hour | Session events are transient by nature |
| Session-flag-derived | 7 days | Flagged moments need rapid validation |

### Archival

Nodes with `importance < archiveThreshold` AND `edge_count = 0` after 90 days without access are soft-archived (`archived_at = now`). They are excluded from retrieval but remain in the database. Event nodes use a shorter archival threshold: 7 days (vs 90 for semantic nodes).

**Important:** Bi-temporally invalidated nodes (`t_valid_until IS NOT NULL`) are **never** archived — they remain as historical record for `sia_at_time` queries. Archival is only for decayed, disconnected nodes that have lost all relevance.

### Nightly Consolidation Sweep

Identifies node pairs with cosine similarity > 0.92 and same kind. Runs the ADD/UPDATE/INVALIDATE/NOOP consolidation decision. Results tracked in `local_dedup_log` (separate from `sync_dedup_log` — these are different processes with different key structures).

### Episodic-to-Semantic Promotion

Queries `sessions_processed` for sessions where `processing_status = 'failed'` or where no row exists (abrupt terminations — the Stop hook never fired). Runs the full dual-track pipeline on those session episodes to recover captured knowledge.

### Bridge Edge Orphan Cleanup

Detects and removes bridge edges in `bridge.db` where one or both endpoint nodes have been archived or no longer exist in their respective `graph.db`.

### Documentation Freshness Integration

Runs the freshness check (Module 11) as part of the maintenance cycle: compares git modification timestamps between DocumentNodes and the code they reference. Applies freshness penalty to stale documentation importance scores.

---

## Module 8 — Team Sync Layer

Disabled by default. Every code path checks `sync_config.enabled` first. When disabled, there are no network calls, no server dependency, no sync overhead.

### Hybrid Logical Clocks (HLC)

All synced nodes and edges carry HLC timestamps for causal ordering. HLC is a 64-bit value: 48-bit physical time (ms) + 16-bit logical counter. HLC overflow guard: logical counter > 0xFFFF → advance physical clock + reset counter.

HLC values are stored as SQLite INTEGER and **always** read via `hlcFromDb()` to convert to BigInt in application code. This is safe for all practical dates (precision maintained until approximately year 285,000).

HLC state is persisted to `~/.sia/repos/<hash>/hlc.json` across process restarts.

### What Gets Synced

| Data | Synced When | Never Synced |
|------|------------|--------------|
| Nodes with `visibility: 'team'` | Always | Private nodes |
| Nodes with `visibility: 'project'` | Matching workspace | Other workspaces |
| Edges where BOTH endpoints are team-visible | With nodes | Edges touching private nodes |
| Cross-repo edges (`bridge.db`) | Both repos have team-visible nodes | Single-private-repo edges |

### Post-Sync VSS Refresh

The sync server (`sqld`) does **not** run `sqlite-vss`. Vector indexes are entirely local. After each pull:

1. Identify newly received nodes (those with `synced_at` set during this pull and `embedding IS NOT NULL`)
2. Open a direct `bun:sqlite` connection (bypassing the libSQL client)
3. Batch-insert embeddings into the local `graph_nodes_vss` virtual table
4. Log to `audit_log` as `VSS_REFRESH`

This cleanly decouples persistence/sync from vector search — the server is a pure data relay.

### Conflict Resolution

Three rules applied when receiving a changeset:

1. **Invalidation is sticky** — if the incoming changeset invalidates a local active node, apply it
2. **New assertions use union semantics** — peer nodes pass through the two-phase consolidation pipeline before commit
3. **Genuine contradictions are flagged** — nodes of same kind with overlapping valid-time windows, high semantic similarity (cosine > 0.85), but contradictory content get a shared `conflict_group_id`

### Node Deduplication After Sync

Three-layer process tracked in `sync_dedup_log`:

| Layer | Method | Action |
|-------|--------|--------|
| 1 — Name match | Jaccard similarity on normalized tokens | >0.95 AND same kind → auto-merge |
| 2 — Embedding | Cosine similarity | >0.92 → merge; 0.80–0.92 → escalate to Layer 3; <0.80 → skip |
| 3 — LLM | Haiku resolution call | SAME → merge; DIFFERENT → keep separate; RELATED → create `relates_to` edge |

Importance for merged node: weighted average using exponential decay by age — `Σ(score_i × e^(-0.01 × age_days_i)) / Σ(e^(-0.01 × age_days_i))` (~70-day half-life per contributor).

### Auth Token Storage

Sync tokens are stored in the OS keychain via `@napi-rs/keyring` (actively maintained NAPI-RS bindings for macOS Keychain, Linux Secret Service, Windows Credential Manager). Tokens **never** appear in `config.json`.

---

## Module 9 — Sandbox Execution Engine

Provides isolated subprocess execution for the `sia_execute`, `sia_execute_file`, and `sia_batch_execute` tools. Raw command output never enters the agent's context directly — it flows through Context Mode indexing.

### Subprocess Executor

`src/sandbox/executor.ts` spawns an isolated subprocess per language with:
- Timeout enforcement (configurable via `sandboxTimeout`, default 30s)
- Auto-detection of language from content/shebang
- Bun fast-path for JavaScript/TypeScript files
- Stdout/stderr capture

Supported runtimes: Python, Node.js, Bun, Bash, Ruby, Go, Rust, Java, PHP, Perl, R.

### Context Mode

When output exceeds `contextModeThreshold` (default 5KB) and an `intent` is provided:

1. Chunk output by lines/paragraphs
2. Embed each chunk with the local ONNX model
3. Create `ContentChunk` nodes with `produced_by` edges to the `ExecutionEvent`
4. Search chunks by intent embedding similarity
5. Return top-K matching chunks (typically < 2KB from 50KB+ output)

This achieves >95% context savings for large command outputs while preserving searchability.

### Credential Passthrough

`src/sandbox/credential-pass.ts` inherits environment variables into the subprocess: `PATH`, `HOME`, `AWS_*`, `GOOGLE_*`, `KUBECONFIG`, `DOCKER_*`, `GH_TOKEN`, etc. Credentials are never stored or logged.

---

## Module 10 — Ontology Constraint Layer

The ontology layer validates all graph mutations before they commit. It implements the principle of constraining the execution environment, not the generation process — the LLM generates freely; validation happens when writes hit the graph.

### Edge Constraints

The `edge_constraints` table declares all valid `(source_kind, edge_type, target_kind)` triples. This is the ontology's core declaration — adding a new valid relationship means inserting a row, not writing a new trigger.

The full constraint set covers:
- **Structural edges**: defines, imports, calls, inherits_from, contains, depends_on
- **Semantic edges**: pertains_to, solves, caused_by, supersedes, elaborates, contradicts
- **Event edges**: modifies, triggered_by, produced_by, resolves, during_task, precedes
- **Session edges**: part_of, continued_from
- **Community edges**: member_of, summarized_by
- **Documentation edges**: child_of, references

### Validation Triggers

Three SQLite triggers enforce constraints at the database level:

1. **`validate_edge_ontology`** — BEFORE INSERT on `graph_edges`: rejects any edge where `(source_kind, edge_type, target_kind)` is not in `edge_constraints`
2. **`validate_supersedes_same_kind`** — BEFORE INSERT: `supersedes` edges must connect same-kind nodes
3. **`guard_convention_pertains_to`** — BEFORE DELETE: prevents removing a Convention's last `pertains_to` edge

### Ontology Middleware (Application Layer)

`src/ontology/middleware.ts` provides typed factory methods that enforce constraints which cannot be expressed as single-row triggers:

- **Co-creation**: `createBug()` requires a `caused_by` edge target — a Bug with no causal anchor is structurally invalid
- **Cardinality**: `createConvention()` requires at least one `pertains_to` target — a Convention that governs nothing is invalid
- **Supersession**: `createDecision()` with `supersedes` validates kind matching and sets `t_valid_until` on the superseded node

### BFO-Inspired Design

The ontology uses the Basic Formal Ontology's continuant/occurrent distinction:

- **Continuants** (persist through changes): CodeSymbol, FileNode, PackageNode, Convention, Community — never hard-deleted, only invalidated
- **Occurrents** (events that unfold through time): EditEvent, ExecutionEvent, GitEvent, ErrorEvent, Bug lifecycle, Decision, Solution — can be archived when importance decays

---

## Module 11 — Knowledge & Documentation Engine

Auto-discovers, chunks, indexes, and tracks freshness of repository documentation. Provides the `sia_note` tool for developer-authored knowledge entry.

### Documentation Auto-Discovery

Priority-ordered file scanner (`src/knowledge/discovery.ts`) discovers documentation at install time, reindex, and via file watcher:

| Priority | Files | Trust Tier | Tag |
|----------|-------|------------|-----|
| 1 — AI context | AGENTS.md, CLAUDE.md, GEMINI.md, .cursor/rules/*.mdc, .windsurf/rules/*.md, .clinerules/*.md, .github/copilot-instructions.md, .amazonq/rules/*.md, .continue/rules/*.md | 1 | `ai-context` |
| 2 — Architecture | ARCHITECTURE.md, DESIGN.md, docs/adr/*.md, docs/decisions/*.md | 1 | `architecture` |
| 3 — Project | README.md, CONTRIBUTING.md, CONVENTIONS.md, CONTEXT.md, docs/*.md | 1 | `project-docs` |
| 4 — API | openapi.yaml, swagger.json, schema.graphql, API.md | 2 | `api-docs` |
| 5 — Changelog | CHANGELOG.md, HISTORY.md, MIGRATION.md, UPGRADING.md | 2 | `changelog` |

Discovery is **hierarchical and JIT**: root-level docs loaded at install, subdirectory docs loaded when the agent accesses files in that subtree. Files matching `.gitignore` or in `node_modules/`, `vendor/`, `.git/`, `dist/`, `build/` are excluded.

### Chunking and Ingestion

`src/knowledge/ingest.ts` performs heading-based chunking with element-aware extraction:

1. Parse YAML frontmatter as node metadata
2. Split at heading boundaries, preserving heading hierarchy in `properties.heading_path`
3. Extract code blocks with language tags (never split across chunks)
4. Keep lists intact within heading-scoped chunks
5. Resolve internal links to `references` edges
6. Detect mentions of known CodeSymbol/FileNode names → `references` edges

Each document becomes a `FileNode` with child `ContentChunk` nodes via `child_of` edges. The ingestion pipeline also promotes chunks whose headings match known patterns ("Decision", "Convention", "Root Cause") to typed semantic nodes with `trust_tier: 1`.

### External Reference Detection

`src/knowledge/external-refs.ts` detects URLs in documentation pointing to Notion, Confluence, Google Docs, Jira, Linear, Figma, Miro, GitHub wikis/issues. Creates `ExternalRef` marker nodes with the URL and service type — no HTTP requests made. For domains with `/llms.txt` support, suggests it as a cleaner ingestion path.

### Freshness Tracking

`src/knowledge/freshness.ts` compares git modification timestamps between documentation and the code it references. When divergence exceeds `freshnessDivergenceThreshold` (default 90 days), the DocumentNode is tagged `potentially-stale` and receives a configurable importance penalty (default -0.15). Real-time freshness verification on access is configurable via `freshnessCheckOnAccess`.

### Template System

`.sia/templates/<kind>.yaml` files define structured fields for knowledge nodes (e.g., ADR template with context/decision/consequences/alternatives). Templates are loaded at startup and validated when `sia_note` is called with a `template` parameter.

---

## Module 12 — Five-Layer Freshness Engine

The fundamental trust problem of a persistent knowledge graph: how do you guarantee that facts derived from code remain accurate as the code evolves? Different fact types demand different freshness strategies. Applying a single mechanism (e.g., TTL-based expiry) to all facts is architecturally wrong — a function signature extracted from an AST is either correct or not (temporal decay is meaningless), while a Decision inferred by an LLM six months ago genuinely loses confidence unless re-confirmed.

### Design Principles

**Never scan the full graph.** The inverted dependency index ensures every invalidation is O(affected nodes), not O(all nodes). For a 50K-node graph where a typical file change affects 5–20 nodes, this is the difference between 0.5ms and 500ms.

**Serve fast, validate async.** The stale-while-revalidate pattern means retrieval latency is always < 1ms for cached facts. Validation happens in the background. The agent is never blocked except for truly rotten facts.

**Early cutoff prevents cascading invalidation.** Inspired by Salsa/Adapton incremental computation: if a source file changes but the derived fact is unchanged (whitespace edit, comment change), stop propagation immediately. This eliminates ~30% of unnecessary re-verification.

### Layer Architecture

```
Layer 1 — File-Watcher Invalidation     [milliseconds]   [>90% of cases]
  File save → Tree-sitter incremental → getChangedRanges → surgical invalidation
Layer 2 — Git-Commit Reconciliation      [seconds]        [merges, rebases, checkouts]
  Git op → diff parse → affected files → bounded BFS with firewalls
Layer 3 — Stale-While-Revalidate Reads   [per-query]      [~0.1ms overhead]
  stat() check → Fresh/Stale/Rotten → serve or block → read-repair
Layer 4 — Confidence Decay               [hours to days]  [LLM-inferred only]
  Exponential decay × trust tier → Bayesian re-observation reset
Layer 5 — Periodic Deep Validation       [daily/weekly]   [batch cleanup]
  Doc-vs-code cross-check → LLM re-verify → PageRank → compaction
```

### Inverted Dependency Index

The `source_deps` table maps every source file to every graph node derived from it. Population rules differ by node kind:

- **CodeSymbol** → 1:1 mapping to the file it was extracted from (`dep_type = 'defines'`)
- **FileNode** → maps to itself (`dep_type = 'defines'`)
- **Decision/Convention/Concept** → union of files referenced by `pertains_to` edges (`dep_type = 'pertains_to'`)
- **ContentChunk** → the document file it was chunked from (`dep_type = 'extracted_from'`)
- **Event nodes** → NOT indexed (historical facts that don't become stale)

An in-memory Cuckoo filter (rebuilt at startup, ~100KB for 50K paths, ~50ns lookup) provides O(1) pre-screening: "does this file have ANY derived nodes?" Unlike Bloom filters, Cuckoo filters support deletion, which is important when source dependencies change.

### Layer 1 — File-Watcher Invalidation

Handles >90% of invalidation cases (code edits during active development):

1. Bun's `FileSystemWatcher` detects file save
2. Debounce 50ms to coalesce rapid saves
3. Tree-sitter incremental re-parse via `TSParser.parse(old_tree, input)`
4. `getChangedRanges()` identifies exactly which AST regions changed
5. Map changed ranges to specific CodeSymbol nodes via inverted dependency index
6. For each affected node: deleted → `invalidateNode()`, modified → re-extract + consolidate, new → standard capture pipeline

End-to-end target: < 200ms per file save.

### Layer 2 — Git-Commit Reconciliation

Handles changes made outside the file watcher's scope (merges, rebases, checkouts, stash pops):

1. PostToolUse hook detects git operations
2. Parse the diff to identify changed files and line ranges
3. Map changes to specific functions/classes using git hunk headers
4. Look up affected graph nodes via inverted dependency index
5. Propagate invalidation via bounded-depth BFS (max 3 hops)
6. **Firewall nodes** (edge_count > 50) stop propagation — if `utils/helpers.ts` is imported by 200 files, changing it does NOT cascade to all 200

### Layer 3 — Stale-While-Revalidate Reads

Per-query freshness check using a three-state model:

| State | Condition | Behavior |
|-------|-----------|----------|
| **Fresh** | Source file unchanged since extraction | Serve immediately (< 0.05ms) |
| **Stale** | Source modified, within staleness window | Serve immediately + async background re-validation |
| **Rotten** | Source modified, beyond staleness window | Block until re-validation completes (10–100ms) |

Staleness windows are context-dependent: 30 seconds for files being actively edited, 5 minutes for files committed this session, infinite for unchanged files (Layers 1–2 handle these).

**Read-repair**: When a stale node is accessed, re-extract inline and update the graph before returning. The result is cached for the staleness window.

### Layer 4 — Confidence Decay

Trust-tier-specific decay strategies, because AST-derived facts and LLM-inferred facts need fundamentally different freshness mechanisms:

**Tier 2 (AST-derived): Event-driven only, no time decay.**
Confidence is binary: 1.0 when source file unchanged, 0.0 when it changes. A function signature extracted 6 months ago from an unchanged file is exactly as reliable as one extracted 5 minutes ago.

**Tier 3 (LLM-inferred): Exponential decay with Bayesian re-observation.**
```
λ = ln(2) / half_life_days
base_decay = base_confidence × e^(-λ × decay_multiplier × days_since_access)
bayesian_confidence = α / (α + β)     // α = re-observations, β = contradictions
confidence = min(base_decay, bayesian_confidence)
```

Each time an LLM-inferred fact is re-extracted from a new session and matches, α increments — the fact becomes more confident through repeated confirmation. Contradictions increment β and flag for review.

| Fact Type | Half-Life | Decay Multiplier | Re-observation |
|-----------|-----------|-----------------|----------------|
| CodeSymbol (Tier 2) | ∞ (event-driven) | N/A | Re-extracted on change |
| Decision (Tier 3) | 14 days | 1.0× | α += 1 |
| Convention (Tier 3) | 21 days | 1.0× | α += 1 |
| Bug/Solution (Tier 3) | 7 days | 1.5× | α += 1 |
| User-stated (Tier 1) | 30 days | 0.5× | α += 2 |
| External (Tier 4) | 7 days | 3.0× | α += 1 |

### Layer 5 — Periodic Deep Validation

Maintenance sweep (startup catchup + idle opportunistic) with four sub-tasks:

1. **Documentation-vs-code cross-validation** — compare document content hashes against referenced code. Tag stale docs.
2. **LLM claim re-verification** — sample 20 lowest-confidence LLM-inferred nodes, check against current code via Haiku
3. **PageRank recomputation** — reload active edges, compute PersonalizedPageRank, update importance scores
4. **Version compaction** — archive old fact versions, hard-delete decayed events, optimize FTS5 index

Target: < 60 seconds total for a 50K-node graph. Runs in a separate connection, never blocks the MCP server.

### Dirty Propagation Engine (Salsa-Inspired)

Coordinates all five layers via a lightweight in-memory dirty state tracker:

**Phase 1 — Push (Active):** When a source file changes, traverse `source_deps` → mark derived nodes as `dirty` → traverse outgoing dependency edges up to depth 2 → firewall nodes (edge_count > 50) stop propagation, marking dependents as `maybe_dirty` instead.

**Phase 2 — Pull (Lazy):** When a query accesses a dirty node → re-verify against source → if UNCHANGED (early cutoff): clear dirty flag, do NOT propagate → if CHANGED: update node, propagate dirty to dependents.

**Durability optimization:** Nodes derived from `node_modules/` or standard library paths are marked `durable` and skip dirty-checking when only user code changes. This eliminates ~30% of the graph from dirty-checking overhead.

### Freshness-Aware Search Results

Each `SiaSearchResult` now carries:
```typescript
freshness: 'fresh' | 'stale' | 'rotten';
freshness_detail?: {
  source_path: string;
  divergence_seconds: number;
  confidence: number;
  alpha?: number;    // Bayesian re-observation count (Tier 3)
  beta?: number;     // Bayesian contradiction count (Tier 3)
};
```

---

## Module 13 — Native Performance Module

An optional Rust module (`@sia/native`) distributed as prebuilt platform-specific npm packages that accelerates the two highest-cost hot paths. No Rust toolchain is required on the user's machine.

### Architecture

Three-tier fallback: Rust native → Wasm → pure TypeScript. `src/native/bridge.ts` is the single import site — all callers are unaware of which implementation runs.

```typescript
// Attempt native → Wasm → TypeScript
let native: NativeModule | null = null;
try { native = require('@sia/native'); }
catch { try { native = require('@sia/native-wasm'); } catch { native = null; } }

export function isNativeAvailable(): 'native' | 'wasm' | 'typescript' { ... }
```

### APIs

**`astDiff(oldTree, newTree, nodeIdMap)`** — Accepts two Tree-sitter parse trees as byte arrays, returns a structured edit script (inserts, removes, updates, moves) mapped to graph node IDs. Uses GumTree matching algorithm. 5–20× speedup over JavaScript.

**`graphCompute(edges, nodeIds, algorithm)`** — Accepts the graph's edge list as flat `Int32Array`, runs PageRank, shortest-path, betweenness centrality, or connected components via petgraph. Caches the graph structure (~6–8MB for 50K nodes) across calls within a session.

**`leidenCommunities(edges, nodeCount, resolutions)`** — Runs Leiden community detection via the `graphrs` crate at multiple resolution levels. Reuses cached petgraph structure. Eliminates any Python dependency for community detection.

### Community Detection Bridge

`src/community/detection-bridge.ts` provides a single `detectCommunities()` function:
- When `@sia/native` available → Rust Leiden via graphrs (< 500ms for 50K nodes)
- When unavailable → JavaScript Louvain via `graphology-communities-louvain` (< 1s for 50K nodes)

JavaScript Louvain includes a connected-components post-processing step to split disconnected communities (addresses Louvain's known ~1% disconnection rate). Modularity difference versus Leiden is ~0.2%, functionally unmeasurable for code knowledge graphs.

### Cross-Compilation

NAPI-RS v3 builds for 6 targets in parallel CI:
- macOS ARM64, macOS x64
- Linux x64 (glibc), Linux x64 (musl/Alpine), Linux ARM64
- Windows x64
- Wasm fallback (universal)

Each platform package is ~3–6MB. Installation via `optionalDependencies` adds < 5 seconds.

### Performance Targets

| Operation | Rust Native | Wasm | TypeScript |
|-----------|------------|------|------------|
| AST diff (500-node trees) | < 10ms | < 25ms | < 100ms |
| PageRank (50K nodes, 30 iter) | < 20ms | < 50ms | < 80ms |
| Shortest path (50K nodes) | < 5ms | < 12ms | < 30ms |
| Leiden (50K nodes, 3 levels) | < 500ms | < 500ms | < 1s (Louvain) |
| Module load time | < 5ms | < 20ms | 0ms |

---

## Module 14 — Hooks-First Capture Engine

Sia's primary knowledge capture mechanism for Claude Code sessions. Rather than re-analyzing session transcripts with a separate LLM (the original Track B approach), hooks observe every tool operation at the moment it happens — at zero additional LLM cost.

**Why hooks instead of API extraction?** Claude Code is already the LLM doing the work. It already understands every decision it makes, every file it writes, every bug it encounters. Making a separate API call to a second LLM to re-analyze what Claude already understood is architecturally redundant. PostToolUse hooks deliver the exact content written, the exact command output, the exact file read — everything the extraction pipeline needs, at the moment it happens, for $0.

### Three-Layer Capture Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 1: Claude Code Hooks (real-time, deterministic, $0)    │
│  PostToolUse → Write/Edit/Bash/Read/MCP tool extraction      │
│  Stop → transcript analysis for uncaptured decisions         │
│  PreCompact/PostCompact → session state snapshots            │
│  SessionStart → context injection via stdout                 │
│  SessionEnd → session finalization                           │
├──────────────────────────────────────────────────────────────┤
│ Layer 2: CLAUDE.md Behavioral Directives (proactive, $0)     │
│  Claude calls sia_note for decisions, conventions, bugs      │
│  Claude calls sia_search before starting tasks               │
│  Captures reasoning and alternatives (the "why")             │
├──────────────────────────────────────────────────────────────┤
│ Layer 3: Pluggable LLM Provider (Module 15 — offline)        │
│  Community summarization, deep validation, batch extraction  │
│  Non-Claude-Code agent fallback (Cursor, Windsurf, Cline)    │
│  Built on Vercel AI SDK: Anthropic, OpenAI, Google, Ollama   │
└──────────────────────────────────────────────────────────────┘
```

### Hook Event Router

`src/hooks/event-router.ts` exposes an HTTP server (default port 4521) alongside the MCP stdio transport. Hook configuration is installed by `npx sia install` into `.claude/settings.json`:

- **PostToolUse**: HTTP async (non-blocking — Claude continues immediately)
- **Stop**: HTTP sync (Sia must finish before Claude proceeds)
- **PreCompact**: HTTP sync (must snapshot before compaction)
- **PostCompact**: HTTP async
- **SessionStart**: Command hook (writes to stdout to inject context)
- **SessionEnd**: HTTP async

### PostToolUse Knowledge Extractor

The core handler fires on every tool operation and applies deterministic extraction rules:

| Tool | Extraction | Graph Mutations |
|------|-----------|----------------|
| **Write** | AST parse → CodeSymbol nodes, knowledge pattern detection in comments | FileNode upsert, EditEvent, CodeSymbol create/update |
| **Edit/MultiEdit** | AST diff → symbol rename/move detection | EditEvent with `modifies` edge, symbol invalidation |
| **Bash** | Command classification, test result parsing, git operation detection | ExecutionEvent, ErrorEvent, GitEvent |
| **Read** | No mutation (read-only) | SearchEvent for importance boosting |
| **MCP (sia_*)** | Log query patterns | SearchEvent |

Knowledge pattern detection (zero LLM) recognizes decision language ("we decided", "chose X over Y"), convention markers ("convention:", "always use"), bug indicators ("BUG:", "FIXME:", "HACK:"), and conventional commit prefixes ("fix:", "feat:", "refactor:").

Processing target: < 100ms per hook event.

### Stop Hook Session Processor

Fires when Claude finishes a response. Reads the transcript segment since the last Stop event and identifies knowledge that PostToolUse couldn't capture — primarily decisions and reasoning expressed in Claude's natural language responses. If Claude already called `sia_note` in the segment, the Stop hook skips semantic analysis. Otherwise, it checks for uncaptured knowledge patterns and, only when ambiguous content is detected, triggers a lightweight Haiku prompt call (~$0.001 per invocation).

### Session Lifecycle Handlers

**SessionStart** (command hook): Queries the graph for relevant context (recent Decisions, active Conventions, unresolved Bugs) and writes a formatted context block to stdout. Claude Code injects this into the conversation — replacing the Session Guide concept with a hook-native implementation.

**PreCompact**: Processes any remaining unextracted knowledge from the transcript, then snapshots the session's graph state to `.sia/session-snapshots/<session_id>.json`.

**PostCompact**: Compares the compacted summary against the pre-compaction snapshot to identify and log what knowledge survived compaction.

**SessionEnd**: Updates the SessionNode's timestamps, computes session statistics, and triggers deferred consolidation.

### Cross-Agent Adapters

`src/hooks/adapters/` normalizes hook events from different agents into Sia's `HookEvent` interface:

| Agent | Hook System | Adapter |
|-------|------------|---------|
| Claude Code | HTTP + command hooks (native) | `claude-code.ts` |
| Cursor | `.cursor/hooks/` (afterFileEdit, afterModelResponse) | `cursor.ts` |
| Cline | PreToolUse/PostToolUse JSON stdin/stdout | `cline.ts` |
| Windsurf, Aider | No hook system | `generic.ts` (api capture mode) |

`npx sia install` auto-detects the active agent and installs appropriate hook configuration.

### Three Capture Modes

| Mode | When | Real-Time Capture | Offline Operations |
|------|------|------------------|-------------------|
| **hooks** (default) | Claude Code detected | PostToolUse + Stop hooks ($0) | LLM provider (summarize + validate roles) |
| **api** | Non-Claude-Code agent | LLM provider (all 4 roles) | LLM provider (all 4 roles) |
| **hybrid** | Explicit config | Hooks for real-time | LLM provider for batch (reindex, digest) |

### Cost Impact

| Approach | Daily Cost | Knowledge Quality |
|----------|-----------|------------------|
| Pure API (original Track B) | ~$0.36/day | Good (100 Haiku calls × $0.0036) |
| Hooks-first (Phase 16) | ~$0.04/day | Better (hooks observe at moment of max context) |

---

## Module 15 — Pluggable LLM Provider

Handles operations that hooks cannot: community summarization (requires full-graph reasoning), deep validation (maintenance sweep (startup catchup or idle processing)), batch extraction (`npx sia reindex`), and non-Claude-Code agent support.

### Provider Registry

Built on the Vercel AI SDK with role-based model assignment:

| Role | Purpose | Active In | Typical Provider |
|------|---------|-----------|-----------------|
| `summarize` | Community summaries, digest generation | All modes | Anthropic (Sonnet) |
| `validate` | Nightly deep validation of LLM-inferred facts | All modes | Ollama (local, $0) |
| `extract` | Knowledge extraction from transcripts | api/hybrid only | Anthropic (Haiku) |
| `consolidate` | Graph consolidation decisions | api/hybrid only | Anthropic (Haiku) |

In `hooks` mode (the default for Claude Code), only `summarize` and `validate` make LLM calls. The `extract` and `consolidate` roles are dormant — hooks handle real-time capture.

### Zod Schemas as Single Source of Truth

Both the hook extractors and the LLM provider produce objects conforming to the same Zod schemas (`src/llm/schemas.ts`). This ensures the downstream consolidation pipeline is identical regardless of capture source:

```typescript
const SiaExtractionResult = z.object({
  entities: z.array(z.object({
    kind: z.enum(['Decision', 'Convention', 'Bug', 'Solution', 'Concept']),
    name: z.string().min(3).max(200),
    content: z.string().min(10).max(2000),
    confidence: z.number().min(0).max(1),
    tags: z.array(z.string()).max(5),
    relates_to: z.array(z.string()),
  })),
  _meta: z.object({
    source: z.enum(['hook', 'llm', 'claude-directive']),
  }).optional(),
});
```

### Reliability Layer

`reliableGenerateObject()` wraps all LLM calls with:
- **Retry**: up to 3 attempts with exponential backoff
- **Fallback chain**: primary provider → next in chain (e.g., Anthropic → OpenAI → Ollama)
- **Circuit breaker**: opens after >50% failures, prevents cascading timeouts
- **json-repair**: fixes ~30% of malformed JSON responses without retrying

### Cost Tracking

Every LLM call is logged to `.sia/cost-log.jsonl` with provider, model, token counts, and estimated cost. Daily budget enforcement warns at 80% and hard-stops at 120%.

### Configuration

```yaml
# sia.config.yaml
capture:
  mode: hooks              # hooks | api | hybrid
  hookPort: 4521

providers:
  summarize:
    provider: anthropic
    model: claude-sonnet-4
  validate:
    provider: ollama
    model: qwen2.5-coder:7b
  extract:
    provider: anthropic
    model: claude-haiku-4-5
  consolidate:
    provider: anthropic
    model: claude-haiku-4-5

fallback:
  chain: [anthropic, openai, ollama]
costTracking:
  budgetPerDay: 1.00
```

---

## Agent Behavioral Layer (CLAUDE.md)

Sia auto-generates a `CLAUDE.md` file in your project root via `npx sia install`. This file is the operative contract between the MCP server's data contracts and correct agent behavior. It governs:

### Task Classification

The agent infers `task_type` from the developer's request before calling any tool:

| Task Type | Trigger Keywords | Boosted Node Kinds |
|-----------|-----------------|---------------------|
| `bug-fix` | fix, broken, error, failing, crash, regression, slow | Bug, Solution |
| `feature` | add, implement, build, create, new, extend | Concept, Decision |
| `review` | review, check, audit, convention, style, PR | Convention |

The classifier also routes sandbox tool usage: when the developer asks to analyze data, process files, or run commands, the agent uses `sia_execute` or `sia_execute_file` instead of raw tool calls.

### Contextual Playbooks

After classification, the agent loads a task-specific playbook from `src/agent/modules/`:

- **Regression** (`sia-regression.md`): `sia_search` → conditional `sia_expand` → **mandatory** `sia_at_time` → explain the delta
- **Feature** (`sia-feature.md`): `sia_community` (orientation) → `sia_search` (decisions/conventions) → `sia_by_file` → implement following constraints
- **Review** (`sia-review.md`): `sia_search` (all conventions, limit=15) → `sia_by_file` per changed file → evaluate against conventions → cite violations by node ID
- **Orientation** (`sia-orientation.md`): `sia_community` level 2 → level 1 → `sia_search` decisions → present as narrative

### Proactive Knowledge Capture Directives

Phase 16 adds CLAUDE.md directives that make Claude proactively call Sia tools when making decisions:

- After choosing between alternatives → `sia_note` with kind='Decision', reasoning, and alternatives
- When establishing a coding pattern → `sia_note` with kind='Convention'
- When discovering a bug's root cause → `sia_note` with kind='Bug'
- When fixing a bug → `sia_note` with kind='Solution' referencing the Bug
- Before starting any coding task → `sia_search` for relevant prior knowledge

These directives are **additive** to hook-based capture. Even if Claude forgets to call `sia_note`, PostToolUse and Stop hooks catch the knowledge deterministically. The directives handle the semantic/reasoning layer (why decisions were made) while hooks handle the structural layer (what was done).

### Invariants (Never Violated)

These rules hold regardless of developer instruction, task type, or context:

1. Max 3 Sia tools before starting work (4 for regressions with `sia_at_time`, 4 for features with `sia_expand`, unlimited `sia_by_file` for reviews)
2. Max 2 `sia_expand` calls per session
3. `workspace: true` only for tasks that genuinely cross repo boundaries
4. Never use Tier 4 as the sole basis for a code change
5. Never silently proceed when `conflict_group_id` is set — present both facts to the developer
6. Always cite retrieved nodes when they constrain decisions
7. For regressions, `sia_at_time` is **mandatory** — never optional
8. Prefer sandbox tools over raw file reads for content > 5 KB. For documentation already ingested into the graph, prefer `sia_search` over reading the raw file.

### Trust Tier Behavioral Rules

| Tier | Agent Behavior |
|------|---------------|
| 1 (User-Direct) | Cite directly. Override only if current code contradicts — then tell the developer. |
| 2 (Code-Analysis) | Highly reliable. Verify only for safety-critical claims. |
| 3 (LLM-Inferred) | Always qualify: "Sia suggests X — let me verify." Check against actual code before acting. |
| 4 (External) | Reference only. Never sole basis for code changes. Name the external provenance. |

### Freshness Qualification

When a search result includes a node tagged `potentially-stale`, the agent qualifies it: "This documentation may be outdated — last updated [date], code modified [date]. Let me verify against current code."

**Invariant 9:** "Never state an LLM-inferred fact (trust_tier 3) as definitive if its confidence has decayed below 0.5. Always qualify: 'Sia's memory suggests X — confidence has decreased since last verification, let me check the current code.'"

**Step 2 freshness rules:**
- `freshness: 'fresh'` → use normally, cite with confidence
- `freshness: 'stale'` → qualify: "This may not reflect the latest code." Verify via sandbox if decision-critical.
- `freshness: 'rotten'` → re-query after blocking re-validation completes

---

## Directory Layout

```
sia/
├── src/
│   ├── graph/
│   │   ├── db-interface.ts       # SiaDb adapter interface + BunSqliteDb + LibSqlDb
│   │   ├── meta-db.ts            # meta.db: workspace/repo/sharing-rules CRUD
│   │   ├── bridge-db.ts          # bridge.db: cross-repo edge CRUD
│   │   ├── semantic-db.ts        # graph.db: migration runner + open
│   │   ├── episodic-db.ts        # episodic.db: connection + open
│   │   ├── nodes.ts              # node CRUD incl. invalidateNode(), archiveNode()
│   │   ├── edges.ts              # edge CRUD incl. invalidateEdge()
│   │   ├── session-resume.ts     # session_resume CRUD (save/load/delete subgraph)
│   │   ├── communities.ts        # community + summary tree CRUD
│   │   ├── staging.ts            # staging area CRUD
│   │   ├── flags.ts              # session flags CRUD
│   │   ├── audit.ts              # audit log (append-only)
│   │   ├── snapshots.ts          # snapshot create + restore
│   │   └── types.ts              # all TypeScript types
│   │
│   ├── workspace/
│   │   ├── detector.ts           # monorepo auto-detection (all package managers)
│   │   ├── manifest.ts           # .sia-manifest.yaml parser
│   │   ├── api-contracts.ts      # OpenAPI/GraphQL/csproj/Cargo/go.mod detector
│   │   └── cross-repo.ts         # bridge.db helpers + ATTACH/DETACH management
│   │
│   ├── capture/
│   │   ├── pipeline.ts           # main orchestration (< 8s total)
│   │   ├── hook.ts               # Claude Code hook entry point
│   │   ├── chunker.ts            # transcript → candidates + trust tier assignment
│   │   ├── track-a-ast.ts        # Tree-sitter extraction via language registry
│   │   ├── track-b-llm.ts        # LLM semantic extraction
│   │   ├── consolidate.ts        # two-phase consolidation
│   │   ├── edge-inferrer.ts      # edge inference + pertains_to after node writes
│   │   ├── event-writer.ts       # typed event node creation for hook events
│   │   ├── flag-processor.ts     # session flag processing
│   │   ├── embedder.ts           # ONNX local embedder (session-cached)
│   │   └── prompts/              # LLM prompt templates
│   │
│   ├── ast/
│   │   ├── languages.ts          # LANGUAGE_REGISTRY (declarative, extensible)
│   │   ├── indexer.ts            # full-repo + incremental indexer
│   │   ├── watcher.ts            # file watcher for incremental re-parse
│   │   ├── extractors/           # per-tier and per-language extractors
│   │   └── pagerank-builder.ts   # PersonalizedPageRank for importance scoring
│   │
│   ├── community/
│   │   ├── leiden.ts             # community detection algorithm
│   │   ├── summarize.ts          # LLM summary generation + cache invalidation
│   │   ├── raptor.ts             # multi-level summary tree
│   │   └── scheduler.ts          # trigger detection
│   │
│   ├── retrieval/
│   │   ├── search.ts             # three-stage pipeline orchestration
│   │   ├── vector-search.ts      # sqlite-vss two-stage retrieval
│   │   ├── bm25-search.ts        # FTS5 keyword search
│   │   ├── graph-traversal.ts    # BFS + 1-hop expansion
│   │   ├── workspace-search.ts   # async ATTACH-based cross-repo retrieval
│   │   ├── reranker.ts           # RRF + trust-weighted scoring
│   │   ├── throttle.ts           # progressive throttling via search_throttle
│   │   ├── query-classifier.ts   # local vs global routing
│   │   └── context-assembly.ts   # result formatting + response budget enforcement
│   │
│   ├── mcp/
│   │   ├── server.ts             # MCP server setup + readonly enforcement
│   │   └── tools/                # one file per tool (16 tools)
│   │       ├── sia-search.ts
│   │       ├── sia-by-file.ts
│   │       ├── sia-expand.ts
│   │       ├── sia-community.ts
│   │       ├── sia-at-time.ts
│   │       ├── sia-flag.ts
│   │       ├── sia-note.ts
│   │       ├── sia-backlinks.ts
│   │       ├── sia-execute.ts
│   │       ├── sia-execute-file.ts
│   │       ├── sia-batch-execute.ts
│   │       ├── sia-index.ts
│   │       ├── sia-fetch-and-index.ts
│   │       ├── sia-stats.ts
│   │       ├── sia-doctor.ts
│   │       └── sia-upgrade.ts
│   │
│   ├── sandbox/
│   │   ├── executor.ts           # subprocess spawning per language
│   │   ├── context-mode.ts       # chunk + embed + index + intent-search
│   │   └── credential-pass.ts    # environment variable inheritance
│   │
│   ├── ontology/
│   │   ├── middleware.ts          # typed factory methods, ontology enforcement
│   │   ├── constraints.ts        # edge constraint definitions and validation
│   │   └── errors.ts             # OntologyError type
│   │
│   ├── knowledge/
│   │   ├── discovery.ts          # priority-ordered file scanner
│   │   ├── ingest.ts             # heading-based chunking + graph ingestion
│   │   ├── external-refs.ts      # external URL detection + ExternalRef nodes
│   │   ├── freshness.ts          # git-based freshness tracking
│   │   ├── templates.ts          # .sia/templates/ loader and validator
│   │   └── patterns.ts           # file patterns for each discovery priority
│   │
│   ├── freshness/
│   │   ├── dirty-tracker.ts        # In-memory dirty state + two-phase propagation
│   │   ├── inverted-index.ts       # source_deps table management
│   │   ├── cuckoo-filter.ts        # In-memory pre-screening filter
│   │   ├── file-watcher-layer.ts   # Layer 1: file-save-driven invalidation
│   │   ├── git-reconcile-layer.ts  # Layer 2: git-commit-driven invalidation
│   │   ├── stale-read-layer.ts     # Layer 3: per-query validation + read-repair
│   │   ├── confidence-decay.ts     # Layer 4: trust-tier-specific decay
│   │   ├── deep-validation.ts      # Layer 5: maintenance batch validation
│   │   └── firewall.ts             # High-fan-out node detection + propagation stop
│   │
│   ├── native/
│   │   ├── bridge.ts               # Load native → Wasm → TypeScript fallback
│   │   ├── fallback-ast-diff.ts    # JavaScript GumTree port
│   │   └── fallback-graph.ts       # JavaScript PageRank/Dijkstra
│   │
│   ├── hooks/
│   │   ├── event-router.ts            # HTTP server + command handler dispatch
│   │   ├── handlers/
│   │   │   ├── post-tool-use.ts       # Core: extract from every tool operation
│   │   │   ├── stop.ts                # Process transcript for missed knowledge
│   │   │   ├── pre-compact.ts         # Snapshot graph state before compaction
│   │   │   ├── post-compact.ts        # Compare against snapshot
│   │   │   ├── session-start.ts       # Inject context (command hook → stdout)
│   │   │   └── session-end.ts         # Finalize session metadata
│   │   ├── extractors/
│   │   │   ├── pattern-detector.ts    # Deterministic knowledge patterns (zero LLM)
│   │   │   ├── write-extractor.ts     # Write tool → FileNode + AST
│   │   │   ├── bash-extractor.ts      # Bash tool → Execution/Error/GitEvent
│   │   │   └── edit-extractor.ts      # Edit tool → EditEvent + AST diff
│   │   └── adapters/
│   │       ├── claude-code.ts         # Native hook integration
│   │       ├── cursor.ts              # Cursor hook normalization
│   │       ├── cline.ts              # Cline hook normalization
│   │       └── generic.ts             # MCP-only fallback (api mode)
│   │
│   ├── llm/
│   │   ├── provider-registry.ts       # Vercel AI SDK provider management
│   │   ├── config.ts                  # sia.config.yaml loader + capture mode
│   │   ├── schemas.ts                 # Zod schemas (shared by hooks AND LLM)
│   │   ├── reliability.ts             # reliableGenerateObject(), retry, fallback
│   │   ├── circuit-breaker.ts         # Per-provider circuit breaker
│   │   ├── cost-tracker.ts            # Per-call cost logging + budget enforcement
│   │   └── prompts/                   # Provider-optimized prompt templates
│   │
│   ├── visualization/
│   │   ├── graph-renderer.ts     # D3.js HTML generation
│   │   ├── subgraph-extract.ts   # scope-based subgraph extraction
│   │   └── template.html         # HTML template with inlined D3
│   │
│   ├── security/
│   │   ├── pattern-detector.ts   # injection pattern regex
│   │   ├── semantic-consistency.ts # domain centroid distance check
│   │   ├── staging-promoter.ts   # promotion pipeline orchestration
│   │   ├── rule-of-two.ts        # LLM-based second opinion
│   │   └── sanitize.ts           # input sanitization
│   │
│   ├── sync/
│   │   ├── hlc.ts                # HLC implementation + hlcFromDb() + overflow guard
│   │   ├── keychain.ts           # @napi-rs/keyring integration
│   │   ├── client.ts             # createSiaDb() factory for libSQL mode
│   │   ├── push.ts               # nodes + bridge edges → server
│   │   ├── pull.ts               # changeset from server + VSS refresh
│   │   ├── conflict.ts           # bi-temporal conflict detection
│   │   └── dedup.ts              # 3-layer dedup → sync_dedup_log
│   │
│   ├── decay/
│   │   ├── decay.ts              # importance decay formula
│   │   ├── archiver.ts           # soft-archive (NOT for invalidated nodes)
│   │   ├── consolidation-sweep.ts # → local_dedup_log
│   │   ├── episodic-promoter.ts  # reads sessions_processed for failed extractions
│   │   └── scheduler.ts          # maintenance scheduler (startup catchup + idle + session-end) + freshness checks
│   │
│   ├── cli/
│   │   ├── index.ts              # CLI entry point
│   │   └── commands/             # one file per command
│   │       ├── install.ts
│   │       ├── stats.ts
│   │       ├── search.ts
│   │       ├── reindex.ts
│   │       ├── doctor.ts
│   │       ├── upgrade.ts
│   │       ├── graph.ts          # npx sia graph (visualization)
│   │       ├── digest.ts         # npx sia digest
│   │       ├── export.ts         # JSON + markdown export
│   │       ├── import.ts         # JSON + markdown import
│   │       ├── rollback.ts
│   │       └── ...               # workspace, team, community, etc.
│   │
│   ├── agent/
│   │   ├── claude-md-template.md # CLAUDE.md base module template
│   │   └── modules/              # contextual playbooks
│   │       ├── sia-regression.md
│   │       ├── sia-feature.md
│   │       ├── sia-review.md
│   │       ├── sia-orientation.md
│   │       ├── sia-tools.md
│   │       └── sia-flagging.md
│   │
│   └── shared/
│       ├── config.ts             # loads, validates, merges config
│       ├── logger.ts
│       └── errors.ts
│
├── migrations/
│   ├── meta/001_initial.sql
│   ├── bridge/001_initial.sql
│   ├── graph/001_initial.sql     # unified graph schema
│   ├── graph/002_ontology.sql    # edge_constraints + validation triggers
│   ├── graph/003_freshness.sql   # source_deps + current_nodes + shadow triggers
│   └── episodic/001_initial.sql
│
├── .sia/
│   └── templates/                # user-defined knowledge templates
│       └── adr.yaml              # example ADR template
│
├── tests/
├── package.json
├── tsconfig.json
└── ARCHITECTURE.md               # This file

sia-native/                          # Rust NAPI-RS module (separate crate)
├── Cargo.toml                       # deps: petgraph, graphrs, tree-sitter
├── src/
│   ├── lib.rs                       # NAPI exports: astDiff, graphCompute, leidenCommunities
│   ├── ast_diff/
│   │   ├── gumtree.rs               # GumTree matching algorithm
│   │   └── edit_script.rs           # Match → insert/remove/update/move ops
│   ├── graph/
│   │   ├── pagerank.rs              # PersonalizedPageRank with seed set
│   │   ├── dijkstra.rs              # Single-source shortest path
│   │   ├── centrality.rs            # Betweenness centrality
│   │   └── components.rs            # Connected components (Tarjan)
│   ├── leiden.rs                    # graphrs Leiden wrapper
│   └── cache.rs                     # In-memory petgraph cache
└── __test__/
    └── index.spec.ts                # Native vs Wasm vs TS comparison tests

# Note: CLAUDE.md is auto-generated by `npx sia install` (gitignored, local only)
```

---

## Key Design Decisions

**Per-repo SQLite with bridge.db for cross-repo edges.** Each `graph.db` has its own WAL lock — concurrent agent sessions on different repos never block each other. Physical isolation: deleting a repo means deleting one directory. Schema migrations are per-repo. Cross-repo edges live in a dedicated `bridge.db` that can be ATTACHed on demand without contaminating per-repo schemas.

**Unified node table with `kind` discriminator.** The v5 architecture uses a single `graph_nodes` table with a `kind` column instead of separate tables per entity type. This enables uniform bi-temporal queries, consistent edge references, and a single FTS5/VSS index across all node types (structural, semantic, event). The `kind` column drives UI rendering, decay half-life selection, and ontology validation.

**Ontology constraint layer.** Validating graph structure at write time (SQLite triggers + application middleware) rather than at generation time preserves full LLM reasoning quality while preventing structurally invalid relationships. The constraint table is declarative — adding a new valid relationship is an INSERT, not a code change.

**SiaDb adapter interface.** The critical fix for the `bun:sqlite` (sync API) vs `@libsql/client` (async API) type mismatch. All CRUD code in `src/graph/` targets `SiaDb`, making the database backend swappable at startup based on sync configuration. VSS operations bypass the adapter via `rawSqlite()`. `BunSqliteDb.executeMany` is atomic (BEGIN/COMMIT/ROLLBACK). Reentrancy guard on `transaction()`.

**Event nodes in the unified graph.** Session events (file edits, command executions, errors) are first-class graph nodes with typed edges, not just episodic log entries. This enables temporal narrative queries ("what happened before this error?"), session continuity across compaction, and causal chain analysis. Event nodes decay rapidly (1-hour half-life) to keep the graph compact.

**Session continuity via subgraph serialization.** PreCompact serializes a priority-weighted subgraph (P1 events first, ≤2 KB budget) to `session_resume`. SessionStart deserializes and re-queries the graph. This preserves context across Claude Code's context compaction without requiring the full session transcript.

**Documentation ingestion as graph nodes.** Repository documentation (AGENTS.md, CLAUDE.md, ADRs, README.md) is chunked and indexed as `ContentChunk` nodes with `references` edges to code symbols. This makes documentation queryable via `sia_search`, relationship-aware, and temporally tracked — not just flat text injection.

**Declarative language registry.** Adding language support is a configuration entry, not a code change. The extraction pipeline dispatches through the registry's `specialHandling` field, not switch statements. Users can register additional Tree-sitter grammars at runtime.

**Full bi-temporal model on both nodes AND edges.** Superseded decisions are invalidated (temporal), not archived (decay). This preserves the historical record for `sia_at_time` queries while keeping current retrieval clean. The distinction between invalidation and archival is load-bearing.

**Post-sync VSS refresh instead of server-side VSS.** The sync server (`sqld`) is a pure data relay — it never interprets embeddings. Vector indexes are local-only, rebuilt from synced embedding BLOBs after each pull. This cleanly decouples persistence/sync from vector search and avoids fragile server-side extension dependencies.

**Haiku for all LLM tasks.** Classification, consolidation, edge inference, community summarization, security checks, and node dedup resolution are all structured decision tasks. Haiku handles them at high quality at a fraction of larger model cost. These are the only Anthropic API calls Sia makes.

**Separate dedup logs.** `local_dedup_log` (maintenance consolidation sweep, intra-developer) and `sync_dedup_log` (post-sync, cross-developer with `peer_id`) are separate tables because they track different processes with different primary key structures. Sharing one table would create key collisions.

**@napi-rs/keyring for OS keychain.** `keytar` was archived in 2022 with no security patches. `@napi-rs/keyring` is actively maintained, uses NAPI-RS for native bindings, and supports macOS Keychain, Linux Secret Service, and Windows Credential Manager.

**Five-layer freshness architecture.** Different fact types demand different freshness strategies — applying a single TTL to all facts is architecturally wrong. AST-extracted facts use event-driven invalidation (time-based decay is meaningless for unchanged code), LLM-inferred facts use exponential decay with Bayesian re-observation reinforcement, and documentation uses periodic cross-validation. The inverted dependency index ensures every invalidation is O(affected nodes), not O(all nodes).

**Salsa-inspired dirty propagation with early cutoff.** If a source file changes but the derived fact is unchanged (whitespace edit, comment change), stop propagation immediately. This eliminates ~30% of unnecessary re-verification, which is critical for maintaining sub-millisecond retrieval during active development.

**Current-state shadow table.** The `current_nodes` table (maintained by triggers) contains only active, non-archived nodes, eliminating the temporal predicate from the most common query pattern. For graphs where 90% of rows are historical versions, this reduces effective table size by ~10×.

**Optional Rust native module with three-tier fallback.** The two genuine performance bottlenecks (AST diffing O(n²) matching, iterative graph algorithms) benefit from 5–20× Rust acceleration, but no user should be blocked by missing native code. The three-tier fallback (native → Wasm → TypeScript) ensures Sia works everywhere while rewarding users who can run native code.

**JavaScript Louvain primary with Rust Leiden upgrade.** Community detection runs in-process via `graphology-communities-louvain` (zero process overhead, < 1s for 50K nodes) with a transparent upgrade to Rust Leiden via `graphrs` when `@sia/native` is available. No Python dependency. No subprocess. The ~0.2% modularity difference is functionally unmeasurable for code knowledge graphs.

**SQLite performance hardening.** `mmap_size=1073741824` (1GB virtual, demand-paged) eliminates one memory copy per page read for 33% faster reads. Partial indexes on all hot-path queries with `WHERE t_valid_until IS NULL AND archived_at IS NULL`. Prepared statement caching for all hot paths. FTS5 automerge=4 for aggressive segment merging.

**Hooks-first capture with three-layer fallback.** Claude Code is already the LLM doing the work — making a separate API call to re-analyze what it already understood is architecturally redundant. PostToolUse hooks deliver full tool I/O at the moment it happens, for $0. The three-layer architecture (hooks → CLAUDE.md directives → pluggable LLM) ensures every agent is supported while optimizing for the Claude Code case: ~$0.04/day vs ~$0.36/day with richer knowledge capture.

**Vercel AI SDK for pluggable providers.** Using `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, and `@ai-sdk/openai-compatible` (Ollama) provides a unified `generateObject()` API with Zod schemas as the single source of truth. Both hook extractors and LLM providers produce the same schema-validated objects, ensuring the consolidation pipeline is capture-source-agnostic.

**Zod schemas shared between hooks and LLM.** The same `SiaExtractionResult` schema validates output from both deterministic hook extractors and probabilistic LLM calls. This is the architectural invariant that makes the capture mechanism invisible to downstream consumers — no code outside `src/llm/` and `src/hooks/` knows which mechanism produced the knowledge.

---

## Air-Gapped Mode

When `airGapped: true` is set, Sia guarantees zero outbound network calls. Every code path that would make a Haiku API call has a guard:

```typescript
if (getConfig().airGapped) return [];  // skip LLM call, return empty
```

| Code Path | Normal Behavior | Air-Gapped Fallback |
|-----------|----------------|---------------------|
| Track B extraction | Haiku semantic extraction | Returns empty `CandidateFact[]` |
| Two-phase consolidation | Haiku decides ADD/UPDATE/INVALIDATE/NOOP | All Track A candidates written as ADD |
| Community summarization | Haiku generates summaries | Serves cached summaries only |
| Rule of Two | Haiku security check | Skipped (3 deterministic checks still run) |
| Sandbox execution | Local subprocesses | **No change** — unaffected |
| Documentation ingestion | Local file scanning + chunking | **No change** — unaffected |
| Retrieval pipeline | No LLM calls (RRF + trust weights) | **No change** — unaffected |
| ONNX embedder | Local model | **No change** — unaffected |
| Freshness Layer 1–3 | File-watcher + git + stale-while-revalidate | **No change** — all local |
| Freshness Layer 4 | Confidence decay | **No change** — purely mathematical |
| Freshness Layer 5 sub-task (b) | Haiku re-verification of LLM claims | Skipped (other sub-tasks still run) |
| Native module | Rust/Wasm acceleration | **No change** — all local |
| Hook-based capture | PostToolUse + Stop deterministic extraction | **No change** — hooks are local |
| LLM provider (extract/consolidate) | Haiku API calls | Disabled in hooks mode; falls back to hooks |
| LLM provider (summarize) | Sonnet community summaries | Skipped (serves cached summaries) |
| LLM provider (validate) | Ollama local validation | **No change** if Ollama running locally |

The security trade-off is explicit: air-gapped deployments accept weaker Tier 4 validation (no Rule of Two) in exchange for zero network dependency. The installer warns about this when air-gap mode is detected.

---

## Configuration Reference

Configuration lives in `~/.sia/config.json`. Full reference:

```jsonc
{
  // Storage paths
  "repoDir":     "~/.sia/repos",
  "modelPath":   "~/.sia/models/all-MiniLM-L6-v2.onnx",
  "astCacheDir": "~/.sia/ast-cache",
  "snapshotDir": "~/.sia/snapshots",
  "logDir":      "~/.sia/logs",

  // Capture
  "captureModel":              "claude-haiku-4-5-20251001",
  "minExtractConfidence":      0.6,       // Track B candidate minimum
  "stagingPromotionConfidence": 0.75,     // Tier 4 promotion minimum

  // Decay
  "decayHalfLife": {
    "default":    30,
    "Decision":   90,
    "Convention": 60,
    "Bug":        45,
    "Solution":   45,
    "event":      0.042                   // ~1 hour (in days)
  },
  "archiveThreshold": 0.05,

  // Retrieval
  "maxResponseTokens":       1500,
  "workingMemoryTokenBudget": 8000,

  // Community
  "communityTriggerNodeCount": 20,
  "communityMinGraphSize":    100,

  // Sandbox
  "sandboxTimeout":          30000,       // subprocess timeout (ms)
  "contextModeThreshold":    5000,        // bytes before Context Mode activates
  "maxChunkSize":            1000,        // max bytes per content chunk

  // Security
  "paranoidCapture": false,               // Hard guarantee: no Tier 4 enters graph

  // Knowledge
  "freshnessDivergenceThreshold": 90,     // days before doc flagged stale
  "freshnessPenalty":             0.15,    // importance penalty for stale docs
  "freshnessCheckOnAccess":      true,    // real-time check on retrieval

  // Flagging
  "enableFlagging":             false,
  "flaggedConfidenceThreshold": 0.4,
  "flaggedImportanceBoost":     0.15,

  // Network
  "airGapped": false,                     // Zero outbound network calls

  // Language extensions
  "additionalLanguages": [],

  // Freshness
  "stalenessWindow": {
    "activeEdit":  30,              // seconds — files being actively edited
    "sessionCommit": 300,           // seconds — files committed this session
    "default": "infinite"           // unchanged files use event-driven invalidation
  },
  "dirtyPropagationDepth": 2,       // max BFS hops for dirty propagation
  "firewallThreshold": 50,          // edge_count above which a node becomes a firewall
  "deepValidationSampleSize": 20,   // LLM claims to re-verify per maintenance sweep
  "versionRetentionDays": 90,       // days before expired versions are compacted

  // Team sync
  "sync": {
    "enabled":      false,
    "serverUrl":    null,
    "developerId":  null,
    "syncInterval": 30                    // seconds between background syncs
    // authToken: stored in OS keychain, never here
  }
}
```

### Capture and Provider Configuration

Capture mode and LLM provider settings live in `sia.config.yaml` (separate from `~/.sia/config.json`):

```yaml
capture:
  mode: hooks              # hooks | api | hybrid
  hookPort: 4521           # HTTP port for hook events

providers:
  summarize:
    provider: anthropic
    model: claude-sonnet-4
  validate:
    provider: ollama
    model: qwen2.5-coder:7b
  extract:
    provider: anthropic
    model: claude-haiku-4-5
  consolidate:
    provider: anthropic
    model: claude-haiku-4-5

fallback:
  enabled: true
  chain: [anthropic, openai, ollama]
  maxRetries: 3

costTracking:
  enabled: true
  budgetPerDay: 1.00
  logFile: .sia/cost-log.jsonl
```
