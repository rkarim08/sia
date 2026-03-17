# Architecture

This document describes how Sia is designed and how its components work together. For a high-level overview, see the [README](README.md).

---

## Table of Contents

- [System Overview](#system-overview)
- [Module Map](#module-map)
- [Data Flow](#data-flow)
- [Module 1 — Multi-Tier Storage](#module-1--multi-tier-storage)
- [Module 2 — Dual-Track Capture Pipeline](#module-2--dual-track-capture-pipeline)
- [Module 3 — Community & Summarization Engine](#module-3--community--summarization-engine)
- [Module 4 — Hybrid Retrieval Engine](#module-4--hybrid-retrieval-engine)
- [Module 5 — MCP Server](#module-5--mcp-server)
- [Module 6 — Security Layer](#module-6--security-layer)
- [Module 7 — Decay & Lifecycle Engine](#module-7--decay--lifecycle-engine)
- [Module 8 — Team Sync Layer](#module-8--team-sync-layer)
- [Agent Behavioral Layer](#agent-behavioral-layer)
- [Directory Layout](#directory-layout)
- [Key Design Decisions](#key-design-decisions)

---

## System Overview

Sia is composed of eight runtime modules plus an agent behavioral layer. Data flows in one direction through the **write path** (hook → capture → staging → consolidation → graph) and one direction through the **read path** (MCP query → retrieval → context assembly → response).

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Claude Code                                 │
│  ┌────────────────────────┐      ┌──────────────────────────────────────┐│
│  │   Hooks System         │      │   MCP Client                        ││
│  │   PostToolUse / Stop   │      │   sia_search, sia_by_file,          ││
│  └──────────┬─────────────┘      │   sia_expand, sia_community,        ││
│             │ hook payload        │   sia_at_time, sia_flag             ││
└────────────┬────────────────────────────────────────┬───────────────────┘
             │                                        │ MCP stdio
             ▼                                        ▼
┌────────────────────────┐        ┌───────────────────────────────────────┐
│  Module 2 — Capture    │        │  Module 5 — MCP Server               │
│  Track A: NLP/AST      │        │  Read-only on main graph             │
│  Track B: LLM (Haiku)  │        │  Write-only on session_flags         │
│  2-Phase Consolidation │        └──────────────────┬────────────────────┘
└──────────┬─────────────┘                           │ read via SiaDb
           │ writes via SiaDb                        ▼
           ▼                        ┌─────────────────────────────────────┐
┌─────────────────────────────────────────────────────────────────────────┐
│                    Module 1 — Multi-Tier Storage                        │
│                                                                         │
│  ~/.sia/meta.db       — workspace registry, sharing rules, API contracts│
│  ~/.sia/bridge.db     — cross-repo edges (ATTACH on demand)            │
│  ~/.sia/repos/<hash>/                                                   │
│    graph.db           — entities, edges, communities, staging, audit    │
│    episodic.db        — append-only interaction archive                 │
│                                                                         │
│  SiaDb adapter wraps bun:sqlite and @libsql/client behind one API      │
└─────────────────────────────────────────────────────────────────────────┘
           │ optional sync
           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Module 8 — Team Sync (disabled by default)                            │
│  @libsql/client embedded replica → self-hosted sqld server             │
│  HLC timestamps · post-sync VSS refresh · bi-temporal conflict flagging│
└─────────────────────────────────────────────────────────────────────────┘

Background processes (non-blocking):
  Module 3 — Community & RAPTOR Engine
  Module 6 — Security Layer (staging promotion)
  Module 7 — Decay & Lifecycle Engine
```

---

## Module Map

| # | Module | Responsibility |
|---|--------|----------------|
| 1 | **Multi-Tier Storage** | SQLite databases, SiaDb adapter, schema management |
| 2 | **Dual-Track Capture** | Hook handling, AST/NLP extraction, LLM extraction, consolidation |
| 3 | **Community Engine** | Leiden detection, RAPTOR summary tree, community summaries |
| 4 | **Hybrid Retrieval** | Vector search, BM25, graph traversal, RRF reranking |
| 5 | **MCP Server** | Read-only tool endpoints, session flag writes |
| 6 | **Security Layer** | Staging area, write guards, pattern detection, Rule of Two |
| 7 | **Decay & Lifecycle** | Importance decay, archival, nightly consolidation sweep |
| 8 | **Team Sync** | HLC timestamps, libSQL replication, conflict resolution |

---

## Data Flow

### Write Path (Capture)

```
Hook fires (PostToolUse / Stop)
    │
    ├─ Parse payload → resolve repo hash → open SiaDb
    ├─ Assign trust tier (1–4) to each chunk
    ├─ If paranoidCapture: quarantine all Tier 4 chunks immediately
    ├─ Write ALL chunks to episodic.db (unconditional)
    │
    ├──────────────────────┐
    ▼                      ▼
Track A (NLP/AST)    Track B (LLM/Haiku)
Deterministic          Probabilistic
~0ms per file          semantic extraction
    │                      │
    └──────────┬───────────┘
               ▼
    Union CandidateFact[]
               │
    ┌──────────┴───────────┐
    ▼                      ▼
Tier 1–3               Tier 4
→ 2-phase              → memory_staging
  consolidation          (3 validation checks
→ edge inference          + Rule of Two)
→ atomic batch write
→ audit log
               │
               ▼
    Process session_flags
    Mark session in sessions_processed
    Trigger community update if threshold met
    Push team-visibility entities if sync enabled
```

### Read Path (Retrieval)

```
MCP tool call (e.g. sia_search)
    │
    ├─ Validate input (Zod schema)
    ├─ Open graph.db read-only via SiaDb
    │
    ▼
Stage 1 — Candidate Generation (parallel)
    ├─ Vector: ONNX embed query → sqlite-vss cosine similarity
    ├─ BM25: FTS5 MATCH with normalized rank
    └─ Graph: entity name lookup → 1-hop expansion
    │
    ▼
Stage 2 — Graph-Aware Expansion
    Fetch direct neighbors of candidates (score × 0.7)
    │
    ▼
Stage 3 — RRF Reranking
    final_score = rrf_score × importance × confidence
                  × trust_weight × (1 + task_boost × 0.3)
    │
    ▼
Context Assembly → Response
```

---

## Module 1 — Multi-Tier Storage

### Database Layout

```
~/.sia/
  meta.db                               # workspace/repo registry, sharing rules
  bridge.db                             # cross-repo edges
  repos/<sha256-of-repo-path>/
    graph.db                            # semantic graph (per-repo)
    episodic.db                         # interaction archive (per-repo)
  models/
    all-MiniLM-L6-v2.onnx              # local embedding model (~90MB)
  ast-cache/<hash>/                     # Tree-sitter parse cache
  snapshots/<hash>/YYYY-MM-DD.snapshot  # daily graph snapshots
  logs/sia.log                          # structured JSON log
```

Every repository gets its own isolated SQLite database, keyed by the SHA-256 of its resolved absolute path. Repositories never share entity IDs or edges unless explicitly linked via a workspace.

### Three Memory Tiers

| Tier | Store | Persistence | Purpose |
|------|-------|-------------|---------|
| **Working Memory** | In-process buffer | Session only | Current context (8K token budget) |
| **Semantic Memory** | `graph.db` | Permanent | Knowledge graph — entities, edges, communities |
| **Episodic Memory** | `episodic.db` | Permanent | Append-only archive of all interactions |

When the working memory budget fills, a compaction event fires: the session is summarized into the semantic graph and working memory resets.

### Bi-Temporal Model

Both entities and edges carry four temporal columns:

| Column | Meaning |
|--------|---------|
| `t_created` | When Sia recorded this fact |
| `t_expired` | When Sia marked it superseded |
| `t_valid_from` | When the fact became true in the world |
| `t_valid_until` | When it stopped being true (NULL = still true) |

Facts are never hard-deleted. Invalidation sets `t_valid_until`. Normal queries filter to `WHERE t_valid_until IS NULL`. The `sia_at_time` tool queries the graph at any historical point by adjusting these filters.

### The SiaDb Adapter

The capture pipeline uses `bun:sqlite` (synchronous). The sync layer uses `@libsql/client` (async). These APIs are incompatible. The `SiaDb` adapter wraps both behind a single interface:

```typescript
interface SiaDb {
  execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  executeMany(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
  transaction(fn: (db: SiaDb) => Promise<void>): Promise<void>;
  close(): Promise<void>;
  rawSqlite(): Database | null;  // for VSS operations; null in libSQL mode
}
```

All CRUD code in `src/graph/` targets `SiaDb`, never the underlying driver directly. The `openSiaDb()` router selects the correct implementation at startup based on sync configuration.

### Cross-Repo Queries via ATTACH

When a query has `workspace: true`, the retrieval engine ATTACHes `bridge.db` and peer repo databases up to SQLite's 10-database limit (main + bridge + up to 8 peers). Missing peer databases are handled gracefully — results include a `missing_repos` metadata field.

### Monorepo Support

Monorepos are auto-detected from package manager configuration:

1. `pnpm-workspace.yaml` → glob patterns under `packages:`
2. `package.json` `"workspaces"` field
3. `nx.json` with per-package `project.json` files
4. `settings.gradle` / `settings.gradle.kts` for Gradle multi-project

The presence of `turbo.json` signals a Turborepo project but is **never** used for package path discovery — that always comes from the underlying package manager.

Within a monorepo, all packages share a single `graph.db` scoped by `package_path`.

---

## Module 2 — Dual-Track Capture Pipeline

The capture pipeline runs two parallel extraction tracks and merges their output through a two-phase consolidation step. The entire pipeline must complete in under 8 seconds.

### Track A — Deterministic (NLP/AST)

Uses Tree-sitter to parse source files through a **declarative language registry** (`src/ast/languages.ts`). The registry is the single source of truth for language support — the pipeline never contains language-specific switch statements.

Languages are organized into four extraction tiers:

| Tier | Capability | Languages |
|------|-----------|-----------|
| **A** | Functions, classes, imports, call sites | TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Swift, PHP, Ruby, Scala, Elixir, Dart |
| **B** | Functions, classes, imports (no calls) | C, C++, C#, Bash, Lua, Zig, Perl, R, OCaml, Haskell |
| **C** | Custom schema extraction | SQL, Prisma |
| **D** | Dependency edges from manifests | `Cargo.toml`, `go.mod`, `pyproject.toml`, `.csproj`, `build.gradle` |

Special handling is dispatched through the registry's `specialHandling` field:
- **C/C++**: Include-path resolution via `compile_commands.json`
- **C#**: `.csproj` `<ProjectReference>` parsing for cross-package edges
- **SQL**: Dedicated schema parser extracts tables, columns, foreign keys, and indexes as first-class graph entities

Adding a new language requires only a registry entry — not changes to the extraction pipeline.

### Track B — Probabilistic (LLM)

Sends conversation turns and ambiguous content to Haiku for semantic extraction. Returns typed `CandidateFact[]` with confidence scores. Candidates below `minExtractConfidence` (default 0.6) are discarded. API failures return an empty array — never propagate up.

### Two-Phase Consolidation

For each Tier 1–3 candidate, the pipeline retrieves the top-5 semantically similar existing entities and runs a Haiku consolidation call that chooses one of four operations:

| Operation | Effect |
|-----------|--------|
| **ADD** | New entity inserted |
| **UPDATE** | Existing entity content merged |
| **INVALIDATE** | Existing entity's `t_valid_until` set; new entity added |
| **NOOP** | Candidate is a duplicate; discarded |

Target compression rate: ≥80% of raw candidates result in NOOP or UPDATE. All writes are batched into a single SiaDb transaction.

### Cross-Repo Edge Detection

After Track A extraction, the pipeline checks `api_contracts` in `meta.db` for contracts where the current repo is a consumer. Detected cross-repo edges are written to `bridge.db`, not `graph.db`.

---

## Module 3 — Community & Summarization Engine

### Leiden Community Detection

Discovers clusters of related entities at three hierarchy levels using composite edge weights:

| Signal | Weight |
|--------|--------|
| Structural AST dependencies | 0.5 |
| Conversation co-occurrence | 0.3 |
| Git co-change | 0.2 |

Three resolution levels:
- **Level 0** (fine) — resolution 2.0
- **Level 1** (medium) — resolution 1.0
- **Level 2** (coarse) — resolution 0.5

Detection triggers after 20 new entities (configurable), with a minimum graph size of 100. For monorepos, detection runs per-package first, then whole-repo for higher levels.

### Summary Cache Invalidation

Summaries are cached by SHA-256 of sorted member entity IDs. After each Leiden run, if community membership changes by more than 20%, the summary is invalidated and regenerated.

### RAPTOR Summary Tree

Four levels of abstraction stored in `summary_tree`:

| Level | Scope | Generated |
|-------|-------|-----------|
| 0 | Raw entity content | On write |
| 1 | Per-entity paragraph summaries | Lazy |
| 2 | Module/package summaries | With community summaries |
| 3 | Architectural overview | Weekly |

---

## Module 4 — Hybrid Retrieval Engine

Retrieval combines three signals via Reciprocal Rank Fusion (RRF).

### Stage 1 — Candidate Generation (parallel)

**Vector search**: Embed query with local ONNX model → two-stage retrieval (B-tree filter on type/importance/t_valid_until → sqlite-vss cosine similarity on filtered set).

**BM25 keyword search**: FTS5 `MATCH` query with normalized rank, filtered to active entities.

**Graph traversal**: Extract entity names from query, direct lookup, 1-hop expansion. Root entities score 1.0, neighbors 0.7.

### Stage 2 — Graph-Aware Expansion

For each candidate, fetch direct neighbors not already in the candidate set. Score at candidate score × 0.7.

### Stage 3 — RRF Reranking

```
rrf_score    = Σ 1/(60 + rank_i)     for each signal i ∈ {vector, bm25, graph}

trust_weight = { 1: 1.00, 2: 0.90, 3: 0.70, 4: 0.50 }[trust_tier]

task_boost   = 1.0 if entity.type matches boosted types for task_type, else 0.0
               bug-fix  → boost Bug, Solution
               feature  → boost Concept, Decision
               review   → boost Convention

final_score  = rrf_score × importance × confidence × trust_weight
               × (1 + task_boost × 0.3)
```

When `paranoid: true`, Tier 4 entities are excluded before Stage 1.

---

## Module 5 — MCP Server

The MCP server exposes six tools over stdio transport. It is **strictly read-only** on the main graph — `graph.db` and `bridge.db` are opened with `OPEN_READONLY`. The only write is to `session_flags`.

### Tool Contracts

| Tool | Input | Output |
|------|-------|--------|
| `sia_search` | query, node_types?, task_type?, workspace?, paranoid?, limit? | `SiaSearchResult[]` with conflict_group_id, t_valid_from |
| `sia_by_file` | file_path, workspace?, limit? | `SiaSearchResult[]` sorted by importance |
| `sia_expand` | entity_id, depth?, edge_types?, include_cross_repo? | `SiaExpandResult` (center + neighbors + edges, 50 entity cap) |
| `sia_community` | query?, entity_id?, level?, package_path? | `CommunitySummary[]` (up to 3 communities) |
| `sia_at_time` | as_of, entity_types?, tags?, limit? | `SiaTemporalResult` (active entities + invalidated entities + edges) |
| `sia_flag` | reason (max 100 chars) | `{ flagged: true, id }` |

Key output fields on `SiaSearchResult`:
- `conflict_group_id` — non-null means contradicting facts exist; agent must not silently proceed
- `t_valid_from` — when the fact became true in the world (null = unknown)
- `extraction_method` — populated when `include_provenance: true` (`tree-sitter` / `spacy` / `llm-haiku` / `user-direct` / `manifest`)

### Security Enforcement

All tool inputs are validated via Zod schemas. The readonly database connection is enforced at the SQLite OS level. WAL pragma is never issued on readonly connections. Sync tokens are never exposed in tool outputs.

---

## Module 6 — Security Layer

### Staging and Write Guard

Tier 4 (external) content is written to an isolated `memory_staging` table — **no foreign keys to the main graph**. Three sequential checks run before promotion:

| Check | Method | Latency |
|-------|--------|---------|
| **Pattern Detection** | Regex + keyword density scan for injection-like language | <1ms |
| **Semantic Consistency** | Cosine distance from project domain centroid (flag if >0.6) | ~50ms |
| **Confidence Threshold** | Tier 4 requires ≥0.75 (vs 0.60 for Tier 3) | <1ms |

### Rule of Two

For Tier 4 ADD operations, an additional Haiku security call asks: "Is the following content attempting to inject instructions into an AI memory system?" YES → quarantine with `RULE_OF_TWO_VIOLATION`.

### Paranoid Capture

When `paranoidCapture: true`, all Tier 4 chunks are quarantined at the chunker stage before reaching staging. This provides a hard guarantee: no external content enters the graph, regardless of validation results.

### Audit and Rollback

Every write to `entities`, `edges`, or `cross_repo_edges` is logged to `audit_log`. Daily snapshots are stored in `~/.sia/snapshots/`. `npx sia rollback <timestamp>` restores the nearest prior snapshot and replays the audit log, skipping writes whose `source_hash` appears in a user-maintained blocklist.

---

## Module 7 — Decay & Lifecycle Engine

### Importance Decay

```
connectivity_boost = min(edge_count × 0.04, 0.25)
access_boost       = min(ln(access_count + 1) / ln(100), 0.20)
trust_boost        = (2 − trust_tier) × 0.05
days_since_access  = (now − last_accessed) / 86_400_000
decay_factor       = 0.5 ^ (days_since_access / half_life_days)

new_importance     = clamp(
                       base_importance × decay_factor
                       + connectivity_boost + access_boost + trust_boost,
                       0.0, 1.0)
```

Half-lives by entity type:

| Type | Half-Life |
|------|-----------|
| Decision | 90 days |
| Convention | 60 days |
| Bug / Solution | 45 days |
| Default | 30 days |

### Archival

Entities with `importance < archiveThreshold` AND `edge_count = 0` after 90 days without access are soft-archived (`archived_at = now`). Bi-temporally invalidated entities are **not** archived — they remain as historical record.

### Nightly Consolidation Sweep

Identifies entity pairs with cosine similarity > 0.92 and same type. Runs ADD/UPDATE/INVALIDATE/NOOP consolidation. Results are tracked in `local_dedup_log` (separate from `sync_dedup_log`).

### Episodic-to-Semantic Promotion

Queries `sessions_processed` for failed or missing sessions (abrupt terminations). Runs the full dual-track pipeline on those episodes to recover captured knowledge.

---

## Module 8 — Team Sync Layer

Disabled by default. All code paths check `sync_config.enabled` first.

### Hybrid Logical Clocks (HLC)

All synced entities and edges carry HLC timestamps for causal ordering. HLC is a 64-bit value: 48-bit physical time (ms) + 16-bit logical counter. Values are stored as SQLite INTEGER and always read via `hlcFromDb()` to preserve BigInt semantics.

### What Gets Synced

| Data | Condition |
|------|-----------|
| Entities | `visibility = 'team'` or `'project'` |
| Edges | Both endpoints are team-visible |
| Cross-repo edges (`bridge.db`) | Both repos have team-visible entities |
| Private entities | **Never** leave the device |

### Post-Sync VSS Refresh

The sync server (`sqld`) does not run `sqlite-vss`. After each pull, a refresh step reads the `embedding` BLOB of newly received entities and inserts them into the local `entities_vss` virtual table using a direct `bun:sqlite` connection.

### Conflict Resolution

1. **Invalidation is sticky** — if incoming changeset invalidates a local entity, apply it
2. **New assertions use union semantics** — peer entities pass through consolidation before commit
3. **Genuine contradictions are flagged** — entities of same type with overlapping valid-time and high semantic similarity but contradictory content get a shared `conflict_group_id`

### Entity Deduplication After Sync

Three-layer process tracked in `sync_dedup_log`:

| Layer | Method | Threshold |
|-------|--------|-----------|
| 1 | Deterministic name match (Jaccard) | >0.95 → auto-merge |
| 2 | Embedding cosine similarity | >0.92 → merge; 0.80–0.92 → Layer 3 |
| 3 | LLM resolution (Haiku) | SAME → merge; DIFFERENT → keep; RELATED → create edge |

### Auth Token Storage

Sync tokens are stored in the OS keychain via `@napi-rs/keyring` (not `keytar`, which was archived in 2022). Tokens never appear in `config.json`.

---

## Agent Behavioral Layer

Sia includes an auto-generated `CLAUDE.md` that governs how Claude Code interacts with the MCP tools. This is not a runtime module — it's injected at session start and acts as a behavioral contract.

The agent layer defines:
- **Task classification** — infers `task_type` (bug-fix / feature / review) from the developer's request
- **Tool selection playbooks** — which tools to call and in what order for each task type
- **Trust tier behavioral rules** — how to treat facts at each confidence level
- **Invariants** — hard limits like max 3 tools before starting work, max 2 `sia_expand` calls per session, mandatory `sia_at_time` for regressions
- **Conflict handling** — never silently proceed when `conflict_group_id` is set

Contextual playbooks for specific task types live in `src/agent/modules/` and are loaded on demand after classification.

---

## Directory Layout

```
sia/
├── src/
│   ├── graph/           # SiaDb adapter, entity/edge CRUD, staging, audit
│   ├── workspace/       # Monorepo detection, API contract detection, bridge helpers
│   ├── capture/         # Pipeline orchestration, Track A, Track B, consolidation
│   ├── ast/             # Language registry, indexer, per-language extractors
│   ├── community/       # Leiden detection, RAPTOR tree, summary generation
│   ├── retrieval/       # Vector search, BM25, graph traversal, RRF reranker
│   ├── mcp/             # MCP server + tool implementations
│   ├── security/        # Pattern detection, staging promotion, Rule of Two
│   ├── sync/            # HLC, keychain, libSQL client, push/pull, dedup
│   ├── decay/           # Importance decay, archival, consolidation sweep
│   ├── cli/             # CLI commands
│   └── shared/          # Config, logger, error types
├── migrations/          # SQL migrations for meta, bridge, graph, episodic
├── tests/
├── package.json
├── tsconfig.json
└── CLAUDE.md            # Auto-generated agent behavioral contract
```

---

## Key Design Decisions

**Per-repo SQLite with bridge.db for cross-repo edges.** Each `graph.db` has its own WAL lock — concurrent sessions on different repos never block. Deleting a repo means deleting a directory. Cross-repo edges live in a dedicated `bridge.db` that can be ATTACHed on demand.

**SiaDb adapter interface.** Resolves the fundamental incompatibility between `bun:sqlite` (sync) and `@libsql/client` (async). All graph CRUD code targets this interface, making the backend swappable at startup.

**Declarative language registry.** Adding language support is a configuration change, not a code change. Special handling (C includes, C# project refs, SQL schemas) dispatches through the registry, not switch statements.

**Full bi-temporal model on both entities AND edges.** Superseded decisions are invalidated (temporal), not archived (decay). This preserves the historical record for temporal queries while keeping current retrieval clean.

**Post-sync VSS refresh instead of server-side VSS.** The server is a pure data relay. Vector indexes are local-only, rebuilt from synced embedding BLOBs. This cleanly decouples persistence/sync from vector search.

**Haiku for all LLM tasks.** Extraction, consolidation, edge inference, summarization, security checks, and dedup resolution. These are structured decision tasks where Haiku performs well at a fraction of larger model cost.

**Separate dedup logs.** `local_dedup_log` (nightly sweep, intra-developer) and `sync_dedup_log` (post-sync, cross-developer with `peer_id`) are separate tables because they track different processes with different key structures.

**Air-gapped mode.** When `airGapped: true`, all LLM calls are skipped. Track A continues deterministically, consolidation falls back to direct-write, community summaries serve from cache, and the Rule of Two is disabled. The ONNX embedder and all retrieval signals are unaffected.

---

## Configuration Reference

Configuration lives in `~/.sia/config.json`. Key settings:

| Setting | Default | Purpose |
|---------|---------|---------|
| `captureModel` | `claude-haiku-4-5-20251001` | LLM for extraction/consolidation |
| `minExtractConfidence` | 0.6 | Minimum confidence for Track B candidates |
| `paranoidCapture` | false | Quarantine all Tier 4 at chunker stage |
| `enableFlagging` | false | Enable `sia_flag` mid-session capture |
| `airGapped` | false | Disable all outbound network calls |
| `maxResponseTokens` | 1500 | Max tokens per MCP tool response |
| `workingMemoryTokenBudget` | 8000 | Working memory compaction threshold |
| `communityTriggerNodeCount` | 20 | New entities before community re-detection |
| `communityMinGraphSize` | 100 | Minimum entities for Leiden to run |
| `archiveThreshold` | 0.05 | Importance below which entities may be archived |
| `sync.enabled` | false | Enable team sync |
| `sync.syncInterval` | 30 | Seconds between background syncs |
