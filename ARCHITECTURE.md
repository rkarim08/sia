# Architecture

This document describes how Sia is built: its data model, runtime modules, data flow paths, and key design decisions. It assumes familiarity with what Sia does (see [README](README.md)). Here you will find the internal "how" -- schemas, interfaces, algorithms, and the reasoning behind them.

---

## Table of Contents

- [System Overview](#system-overview)
- [Data Model](#data-model)
- [Module Reference](#module-reference)
  - [Storage Layer](#storage-layer-modules-1-20)
  - [Capture Layer](#capture-layer-modules-2-14-18-19)
  - [Intelligence Layer](#intelligence-layer-modules-3-7-12-22)
  - [Retrieval Layer](#retrieval-layer-module-4)
  - [Transformer Layer](#transformer-layer-modules-24-28)
  - [Interface Layer](#interface-layer-modules-5-16-17-23)
  - [Security Layer](#security-layer-module-6)
  - [Integration Layer](#integration-layer-modules-8-9-10-11-15-21)
  - [Performance Layer](#performance-layer-module-13)
- [Directory Layout](#directory-layout)
- [Data Flow Diagrams](#data-flow-diagrams)
- [Key Design Decisions](#key-design-decisions)
- [Configuration Reference](#configuration-reference)
- [Testing](#testing)

---

## System Overview

Sia is composed of 28 runtime modules plus an agent behavioral layer. Data flows through two primary paths:

- **Write path:** hook event --> event node --> Track A (AST) + Track B (LLM) --> consolidation --> ontology validation --> graph
- **Read path:** MCP query --> parallel retrieval (vector + BM25 + graph) --> cross-encoder reranking (T3) --> attention fusion (T1+) --> trust-weighted output --> freshness annotation --> response

The MCP server is strictly read-only on the main graph, with dedicated write connections for event nodes, session flags, and session resume data.

```
+--------------------------------------------------------------------------+
|                              Claude Code                                 |
|  +------------------------+      +--------------------------------------+|
|  |   Hooks System         |      |   MCP Client                         ||
|  |   PostToolUse / Stop / |      |   sia_search, sia_by_file,           ||
|  |   SessionStart /       |      |   sia_expand, sia_community,         ||
|  |   PreCompact           |      |   sia_at_time, sia_flag, sia_note,   ||
|  +----------+-------------+      |   sia_backlinks, sia_execute,        ||
|                                  |   sia_models, ...                    ||
|             | hook payload       +------------------+-------------------+|
+-------------+-------------------------------------------+----------------+
              |                                           | MCP stdio
              v                                           v
+-------------+-----------+        +----------------------+----------------+
|  Capture Pipeline        |        |  MCP Server                           |
|  Track A: NLP/AST        |        |  Read-only on main graph              |
|  Track B: LLM (Haiku)    |        |  Write: event nodes, session_flags,   |
|  Consolidation + Ontology|        |         session_resume (WAL mode)     |
+----------+---------------+        +------------------+-------------------+
           | writes via SiaDb                          | read via SiaDb
           v                                           v
+--------------------------------------------------------------------------+
|                         Multi-Tier Storage                               |
|  ~/.sia/meta.db      -- workspace registry, sharing rules, API contracts |
|  ~/.sia/bridge.db    -- cross-repo edges (ATTACH on demand)              |
|  ~/.sia/repos/<hash>/                                                    |
|    graph.db          -- unified graph (nodes, edges, ontology, ...)       |
|    episodic.db       -- append-only interaction archive                   |
|  SiaDb adapter wraps bun:sqlite and @libsql/client behind one API        |
+--------------------------------------------------------------------------+
```

### Module Dependency Graph

```
Hooks (14) --+--> Capture (2) --> Storage (1)
             |        |               ^
             |        v               |
             |   Ontology (10) -------+
             |        ^               |
             v        |               |
        LLM (15) -----+     Branch Layer (20)
             |
             v
       Community (3) --> Storage (1)
             |
             v
     Freshness (12) <--> Decay (7)
             |               |
             v               v
       Retrieval (4) --> MCP Server (5)
             ^               |
             |               v
       Model Mgr (24)  Plugin Layer (16) --> Auto-Integration (17)
             |                           --> Skills/Agents (19, 21)
             +---> Cross-Encoder (25)    --> Visualizer (23)
             +---> Attn Fusion (26)
             +---> GLiNER (28)
             |
       Feedback (27) <--> Attn Fusion (26)
             ^
             |
       Security (6)
```

---

## Data Model

### Four Databases

| Database | Scope | Purpose |
|----------|-------|---------|
| `graph.db` | Per-repo | Unified knowledge graph: nodes, edges, communities, staging, flags, audit |
| `episodic.db` | Per-repo | Append-only interaction archive (ground truth) |
| `meta.db` | Global | Workspace/repo registry, sharing rules, API contracts, sync config |
| `bridge.db` | Global | Cross-repo edges (workspace members only) |

Repos are identified by `sha256(resolved_absolute_path)`. Each repo gets isolated databases under `~/.sia/repos/<hash>/`.

### Three Memory Tiers

| Tier | Store | Persistence | Purpose |
|------|-------|-------------|---------|
| Working Memory | In-process buffer | Session only | Current context (configurable 8K token budget) |
| Semantic Memory | `graph.db` | Permanent | Knowledge graph nodes, edges, communities |
| Episodic Memory | `episodic.db` | Permanent | Append-only archive of all interactions |

### Core Schemas

**graph_nodes** -- unified node store with `kind` discriminator:

| Column Group | Key Columns |
|-------------|-------------|
| Identity | `id` (UUID v4), `kind` (NodeKind), `name`, `content`, `summary` |
| Scoping | `package_path` (monorepo), `tags` (JSON), `file_paths` (JSON) |
| Scoring | `trust_tier` (1-4), `confidence` (0-1), `importance` (0-1), `priority_tier` (P1-P4) |
| Counters | `access_count`, `edge_count` (trigger-maintained) |
| Temporal | `t_created`, `t_expired`, `t_valid_from`, `t_valid_until` |
| Team | `visibility` (private/team/project), `created_by`, `conflict_group_id` |
| Provenance | `extraction_method`, `embedding` (384-dim BLOB), `embedding_code` (768-dim BLOB, T1+), `archived_at` |
| Flexible | `session_id`, `properties` (JSON) |

**graph_edges** -- typed, weighted, bi-temporal relationships:

| Column | Purpose |
|--------|---------|
| `id`, `from_id`, `to_id` | Identity + FK to graph_nodes |
| `type` | Constrained by `edge_constraints` table |
| `weight`, `confidence`, `trust_tier` | Scoring |
| `t_created`, `t_expired`, `t_valid_from`, `t_valid_until` | Bi-temporal |

**edge_constraints** -- ontology declaration of valid `(source_kind, edge_type, target_kind)` triples. Adding a new relationship is an INSERT, not code.

### Bi-Temporal Model

Nodes and edges carry four temporal columns. Facts are never hard-deleted.

| Column | Meaning | Set By |
|--------|---------|--------|
| `t_created` | When Sia recorded this fact | INSERT time |
| `t_expired` | When Sia marked it superseded | `invalidateNode()` |
| `t_valid_from` | When the fact became true in the world | Extraction |
| `t_valid_until` | When the fact stopped being true | `invalidateNode()` |

**Critical distinction:** `t_valid_until` (temporal invalidation) is for superseded facts. `archived_at` (lifecycle archival) is for decayed, disconnected nodes. Invalidated nodes remain queryable via `sia_at_time`; archived nodes do not.

### Entity Types (NodeKind)

```typescript
type StructuralKind = "CodeSymbol" | "FileNode" | "PackageNode";
type SemanticKind   = "Concept" | "Decision" | "Bug" | "Solution"
                    | "Convention" | "Community" | "ContentChunk";
type EventKind      = "SessionNode" | "EditEvent" | "ExecutionEvent"
                    | "SearchEvent" | "GitEvent" | "ErrorEvent"
                    | "UserDecision" | "UserPrompt" | "TaskNode";
type NodeKind       = StructuralKind | SemanticKind | EventKind | "ExternalRef";
```

### Edge Types

```typescript
type StructuralEdgeType = "defines" | "imports" | "calls" | "inherits_from"
                        | "contains" | "depends_on";
type SemanticEdgeType   = "pertains_to" | "solves" | "caused_by" | "supersedes"
                        | "elaborates" | "contradicts" | "relates_to" | "references";
type CommunityEdgeType  = "member_of" | "summarized_by";
type EventEdgeType      = "modifies" | "triggered_by" | "produced_by"
                        | "resolves" | "during_task" | "precedes";
type SessionEdgeType    = "part_of" | "continued_from";
type DocEdgeType        = "child_of";
```

### Trust Tiers

| Tier | Source | Weight in RRF |
|------|--------|---------------|
| 1 | User-Direct (`sia_note`, user statements) | 1.00 |
| 2 | Code-Analysis (Tree-sitter AST) | 0.90 |
| 3 | LLM-Inferred (Haiku extraction) | 0.70 |
| 4 | External (URLs, unfamiliar paths) | 0.50 |

### The SiaDb Adapter

All CRUD code targets the `SiaDb` interface, never raw `bun:sqlite` or `@libsql/client`:

```typescript
interface SiaDb {
  execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  executeMany(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
  transaction(fn: (db: SiaDb) => Promise<void>): Promise<void>;
  close(): Promise<void>;
  rawSqlite(): Database | null;  // for VSS operations; null in libSQL mode
  sync?(): Promise<void>;
}
```

Two implementations: `BunSqliteDb` (local-only, sync API) and `LibSqlDb` (team sync, async via `@libsql/client`). The `openSiaDb()` factory selects the implementation at startup based on `SyncConfig`.

---

## Module Reference

### Storage Layer (Modules 1, 20)

#### Module 1: Multi-Tier Storage

**Purpose:** SQLite database management, schema migrations, and the SiaDb adapter interface.

**Key files:** `src/graph/db-interface.ts`, `src/graph/nodes.ts`, `src/graph/edges.ts`, `src/graph/semantic-db.ts`, `src/graph/meta-db.ts`, `src/graph/bridge-db.ts`, `src/graph/episodic-db.ts`

**Key exports:** `SiaDb`, `BunSqliteDb`, `LibSqlDb`, `openDb()`, `openSiaDb()`, `createMemoryDb()`

**Data flow:** All other modules read/write through `SiaDb`. Graph mutations go through `nodes.ts` and `edges.ts`. Migration files in `migrations/` are applied by `runMigrations()`.

**Supporting tables:** `memory_staging` (isolated staging for Tier 4 content), `session_resume` (session continuity), `source_deps` (inverted dependency index), `current_nodes` (trigger-maintained shadow table of active nodes), `graph_nodes_fts` (FTS5), `graph_nodes_vss` (sqlite-vss), `communities`, `session_flags`, `audit_log`, `search_throttle`.

**Cross-repo queries:** When `workspace: true`, retrieval ATTACHes `bridge.db` and up to 8 peer repos. Missing peers handled gracefully.

**Monorepo support:** Auto-detected from `pnpm-workspace.yaml`, `package.json` workspaces, `nx.json`, or `settings.gradle`. All packages share a single `graph.db` scoped by `package_path`.

#### Module 20: Branch-Aware Graph Layer

**Purpose:** Per-worktree isolation and branch-keyed snapshots for feature branch work.

**Key files:** `src/graph/branch-snapshots.ts`

**Key exports:** `resolveWorktreeRoot()`, `saveBranchSnapshot()`, `restoreBranchSnapshot()`

**Data flow:** PostToolUse handler detects `git checkout/switch/worktree add` --> saves current branch snapshot --> restores target branch snapshot. On merge, feature branch nodes are consolidated into main's graph.

**Dependencies:** Module 1 (storage), Module 14 (hooks)

**Schema:** `branch_snapshots` table with `branch_name`, `commit_hash`, `snapshot_data` (JSON blob of active nodes + edges).

---

### Capture Layer (Modules 2, 14, 18, 19)

#### Module 2: Dual-Track Capture Pipeline

**Purpose:** Two parallel extraction tracks (AST + LLM) with two-phase consolidation and ontology validation. Must complete in under 8 seconds.

**Key files:** `src/capture/pipeline.ts`, `src/capture/track-a-ast.ts`, `src/capture/track-b-llm.ts`, `src/capture/consolidate.ts`, `src/capture/edge-inferrer.ts`, `src/capture/event-writer.ts`

**Key exports:** `runCapturePipeline()`, `consolidate()`, `inferEdges()`

**Data flow:**
1. Hook fires --> parse payload --> create event node with `part_of` edge to SessionNode
2. Assign trust tier (1-4) to each chunk
3. Write all chunks to `episodic.db` unconditionally
4. Track A (Tree-sitter AST, ~0ms): CodeSymbol, FileNode, PackageNode with structural edges
5. Track B (Haiku LLM): Decision, Convention, Bug, Solution, Concept with semantic extraction
6. Union `CandidateFact[]` --> two-phase consolidation (match, then NOOP/UPDATE/INVALIDATE/ADD)
7. Ontology validation --> atomic batch write --> audit log

**Consolidation operations:** NOOP (duplicate, discard), UPDATE (merge into existing), INVALIDATE (supersede existing), ADD (genuinely new). Target: >=80% of candidates result in NOOP or UPDATE.

**Dependencies:** Module 1 (storage), Module 10 (ontology), Module 15 (LLM for Track B)

#### Module 14: Hooks-First Capture Engine

**Purpose:** Real-time knowledge capture via Claude Code hooks at zero LLM cost. Primary capture mechanism.

**Key files:** `src/hooks/event-router.ts`, `src/hooks/handlers/post-tool-use.ts`, `src/hooks/handlers/stop.ts`, `src/hooks/handlers/session-start.ts`, `src/hooks/extractors/pattern-detector.ts`, `src/hooks/adapters/`

**Key exports:** `HookEventRouter`, `PostToolUseHandler`, `StopHandler`, `SessionStartHandler`

**Data flow:** HTTP server (port 4521) receives hook payloads. PostToolUse fires on every tool operation with deterministic extraction rules:

| Tool | Extraction | Graph Mutations |
|------|-----------|----------------|
| Write | AST parse, knowledge pattern detection | FileNode, EditEvent, CodeSymbol |
| Edit | AST diff, symbol rename/move detection | EditEvent with `modifies` edge |
| Bash | Command classification, test/git parsing | ExecutionEvent, ErrorEvent, GitEvent |
| Read | No mutation (read-only) | SearchEvent for importance boosting |

**Three-layer architecture:** (1) Hooks (real-time, $0), (2) CLAUDE.md directives (proactive `sia_note`, $0), (3) LLM provider (offline). Cross-agent adapters normalize events from Cursor, Cline, and generic agents.

**Dependencies:** Module 1 (storage), Module 2 (capture pipeline), Module 15 (LLM for Stop hook)

#### Module 18: Worker-Threaded Indexer

**Purpose:** Parallel file parsing for repositories with 100K+ files using `N-1` CPU cores.

**Key files:** `src/ast/worker-indexer.ts`, `src/ast/languages.ts`, `src/ast/indexer.ts`

**Key exports:** `WorkerIndexer`, `LANGUAGE_REGISTRY`

**Data flow:** Main thread walks file tree --> queues files via MessageChannel --> workers parse with Tree-sitter --> results collected --> batch SQL insert (500/batch) with IN-clause dedup.

**Crash recovery:** Mtime cache saved every 500 files. Progress file tracks last indexed path. Each 500-file batch is a single transaction.

**Performance:** 10K files < 30s cold, 100K files < 5min cold, incremental < 10s.

**Dependencies:** Module 1 (storage), Module 10 (ontology for edge validation)

#### Module 19: /sia-learn Orchestrator

**Purpose:** 5-phase pipeline that builds or incrementally updates the complete knowledge graph.

**Key files:** `skills/sia-learn.md`

**Phases:** (0) Auto-install verification, (1) Code indexing via Module 18, (2) Documentation ingestion via Module 11, (3) Community detection via Module 3, (4) Summary report generation.

**Crash recovery:** State persisted to `.sia-learn-progress.json`. Each phase runs inside `runWithRetry()` (3 attempts, exponential backoff). Pipeline resumes from last incomplete phase.

**Dependencies:** Module 18 (indexing), Module 11 (docs), Module 3 (communities), Module 20 (branch snapshot on completion)

---

### Intelligence Layer (Modules 3, 7, 12, 22)

#### Module 3: Community and Summarization Engine

**Purpose:** Leiden/Louvain community detection and RAPTOR multi-level summary tree.

**Key files:** `src/community/leiden.ts`, `src/community/summarize.ts`, `src/community/raptor.ts`, `src/community/scheduler.ts`

**Key exports:** `detectCommunities()`, `summarizeCommunities()`, `buildRaptorTree()`

**Data flow:** Triggered after 20 new nodes. Builds composite edge weights (AST 0.5, co-occurrence 0.3, git co-change 0.2). Runs detection at three resolution levels (fine 2.0, medium 1.0, coarse 0.5). Summary cache invalidated when membership changes >20%.

**RAPTOR levels:** Level 0 (raw content), Level 1 (per-node summaries), Level 2 (module summaries with community), Level 3 (architectural overview, weekly).

**Dependencies:** Module 1 (storage), Module 13 (native Leiden if available), Module 15 (LLM for summaries)

#### Module 7: Decay and Lifecycle Engine

**Purpose:** Importance decay, node archival, nightly consolidation sweep, and episodic-to-semantic promotion.

**Key files:** `src/decay/decay.ts`, `src/decay/archiver.ts`, `src/decay/consolidation-sweep.ts`, `src/decay/episodic-promoter.ts`, `src/decay/scheduler.ts`

**Key exports:** `computeDecay()`, `archiveNodes()`, `runConsolidationSweep()`, `promoteEpisodicSessions()`

**Decay formula:** `new_importance = clamp(base * 0.5^(days/half_life) + connectivity_boost + access_boost + trust_boost, 0, 1)`. Half-lives: Decision 90d, Convention 60d, Bug/Solution 45d, default 30d, events 1h.

**Archival:** Nodes with `importance < 0.05` AND `edge_count = 0` after 90 days are soft-archived. Bi-temporally invalidated nodes are never archived.

**Dependencies:** Module 1 (storage), Module 12 (freshness checks during maintenance)

#### Module 12: Five-Layer Freshness Engine

**Purpose:** Guarantee that facts derived from code remain accurate as code evolves, using layer-appropriate strategies.

**Key files:** `src/freshness/file-watcher-layer.ts`, `src/freshness/git-reconcile-layer.ts`, `src/freshness/stale-read-layer.ts`, `src/freshness/confidence-decay.ts`, `src/freshness/deep-validation.ts`, `src/freshness/inverted-index.ts`, `src/freshness/dirty-tracker.ts`, `src/freshness/cuckoo-filter.ts`

**Five layers:** (1) File-watcher invalidation (<200ms, >90% of cases), (2) Git-commit reconciliation (merges/rebases), (3) Stale-while-revalidate reads (Fresh/Stale/Rotten per query), (4) Confidence decay (exponential with Bayesian re-observation for LLM-inferred facts), (5) Periodic deep validation (daily/weekly batch).

**Inverted dependency index:** `source_deps` maps source files to derived graph nodes. Cuckoo filter (~100KB for 50K paths) provides O(1) pre-screening.

**Dirty propagation (Salsa-inspired):** Push phase marks derived nodes dirty on source change. Pull phase re-verifies on access with early cutoff (unchanged derived fact stops propagation). Firewall nodes (edge_count > 50) stop cascade.

**Dependencies:** Module 1 (storage), Module 15 (LLM for Layer 5 re-verification)

#### Module 22: Knowledge Lifecycle Engine

**Purpose:** Proactive context injection, session resume, freshness annotation, and maintenance scheduling.

**Key files:** `src/decay/scheduler.ts`, `src/freshness/confidence-decay.ts`

**Key exports:** `MaintenanceScheduler`, `computeConfidence()`, `saveSubgraph()`, `loadSubgraph()`

**Proactive injection:** PostToolUse on Read tool queries graph for related entities and injects context without requiring explicit `sia_by_file` calls. **Session resume:** PreCompact serializes priority-weighted subgraph (P1 first, 2KB budget) to `session_resume`; SessionStart deserializes and builds Session Guide.

**Maintenance scheduler:** Startup catchup (max 60s) + idle opportunistic (after 30s quiet). Work units ordered by priority: decay sweep (6h), archive check (6h), consolidation (12h), episodic promotion (24h), deep validation (24h), bridge cleanup (48h).

**Dependencies:** Module 1 (storage), Module 7 (decay), Module 12 (freshness), Module 14 (hooks for injection)

---

### Retrieval Layer (Module 4)

#### Module 4: Hybrid Retrieval Engine

**Purpose:** Four-stage retrieval pipeline with parallel candidate generation, cross-encoder reranking, learned attention fusion, trust-weighted output, progressive throttling, and query routing.

**Key files:** `src/retrieval/search.ts`, `src/retrieval/vector-search.ts`, `src/retrieval/bm25-search.ts`, `src/retrieval/graph-traversal.ts`, `src/retrieval/reranker.ts`, `src/retrieval/throttle.ts`, `src/retrieval/query-classifier.ts`, `src/retrieval/context-assembly.ts`

**Four-stage pipeline:**

1. **Parallel Retrieval** -- Candidate generation from three signals in parallel: vector (ONNX embed --> sqlite-vss cosine, dual embeddings at T1+), BM25 (FTS5), graph traversal (name lookup --> 1-hop expansion, root 1.0, neighbors 0.7). At T1+, the query classifier selects bge-small (natural language) or jina-code (code queries) for the vector channel.
2. **Cross-Encoder Reranking** (T3) -- mxbai-rerank-base-v1 scores each (query, candidate) pair jointly. Eliminates false positives that pass Stage 1 due to lexical or embedding overlap. At T0-T2, this stage is skipped and candidates pass directly to Stage 3.
3. **Attention Fusion** (T1+) -- The SIA Attention Fusion Head (Module 26) replaces static RRF. A 2-layer, 4-head transformer merges BM25 rank, vector cosine, graph proximity, cross-encoder score (if available), trust tier, importance, and node kind into a single relevance score. At T0, classic RRF is used: `final = rrf * importance * confidence * trust_weight * (1 + task_boost * 0.3)`.
4. **Trust-Weighted Output** -- Final scores are scaled by trust tier weight and importance decay. Response budget enforcement and context assembly produce the JSON response.

**Progressive throttling:** Normal (1-3 calls), Reduced (4-8, fewer results), Blocked (9+, redirect to `sia_batch_execute`).

**Query routing:** Broad queries use community summaries; specific queries use the four-stage pipeline; ambiguous queries use DRIFT-style iterative deepening.

**Dependencies:** Module 1 (storage), Module 3 (communities for global mode), Module 24 (model manager for tier detection), Module 25 (cross-encoder), Module 26 (attention fusion)

---

### Transformer Layer (Modules 24-28)

#### Module 24: Tiered Model Manager

**Purpose:** Lazy download, activation, and lifecycle management for the tiered model stack (T0-T3). Provides the model manifest consumed by all downstream modules.

**Key files:** `src/models/manager.ts`, `src/models/manifest.ts`, `src/models/downloader.ts`, `src/models/registry.ts`

**Key exports:** `ModelManager`, `getManifest()`, `activateTier()`, `isModelAvailable()`

**Data flow:** On startup, reads `~/.sia/models/manifest.json` to determine the installed tier. When a higher tier is activated (`sia models activate T<n>`), downloads missing models lazily, updates the manifest, and emits a `tier-changed` event. Downstream modules (25, 26, 28) subscribe to this event and reconfigure accordingly.

**Model registry:**

| Tier | Model | Role | Size |
|------|-------|------|------|
| T0 | bge-small-en-v1.5 | NL embedding | ~33 MB |
| T0 | all-MiniLM-L6-v2 | Fallback NL embedding | ~24 MB |
| T1 | jina-embeddings-v2-base-code | Code embedding | ~137 MB |
| T1 | nomic-embed-text-v1.5 | Enhanced NL embedding | ~137 MB |
| T1 | SIA Attention Fusion Head | Learned signal fusion | ~26 MB |
| T2 | GLiNER-small | On-device NER | ~183 MB |
| T3 | mxbai-rerank-base-v1 | Cross-encoder reranker | ~739 MB |

**Dependencies:** None (leaf module; provides models to Modules 4, 25, 26, 27, 28)

#### Module 25: Cross-Encoder Reranker

**Purpose:** Score (query, candidate) pairs jointly using a cross-encoder model to eliminate false positives from Stage 1 retrieval.

**Key files:** `src/retrieval/cross-encoder.ts`, `src/retrieval/reranker.ts`

**Key exports:** `CrossEncoderReranker`, `rerankWithCrossEncoder()`

**Data flow:** Receives candidate list from Stage 1 of Module 4. For each candidate, concatenates `[CLS] query [SEP] candidate_text [SEP]` and runs through the mxbai-rerank-base-v1 ONNX model. Returns relevance scores in `[0, 1]`. Candidates below the dynamic threshold (mean - 0.5 * stddev) are pruned.

**Availability:** Active at T3 only. At T0-T2, Module 4 skips this stage.

**Dependencies:** Module 24 (model availability check), Module 1 (storage for candidate text retrieval)

#### Module 26: Attention Fusion Head

**Purpose:** Replace static RRF with a learned 2-layer transformer that fuses retrieval signals into a single relevance score per candidate.

**Key files:** `src/retrieval/attention-fusion.ts`, `src/retrieval/fusion-head.ts`, `src/retrieval/fusion-trainer.ts`

**Key exports:** `AttentionFusionHead`, `fuseSignals()`, `trainFusionHead()`

**Architecture:** 2 transformer encoder layers, 4 attention heads, 64-dim hidden. Input is a feature vector per candidate: BM25 rank (normalized), vector cosine similarity, graph proximity score, cross-encoder score (0 if unavailable), trust tier (one-hot), importance, node kind (one-hot). Output is a scalar relevance score per candidate.

**Training:** Initializes with heuristic weights equivalent to tuned RRF. After 50+ feedback events accumulate (Module 27), periodic fine-tuning runs via `trainFusionHead()`. Training applies IPS-style correction for trust-tier position bias (Agarwal et al., 2019). Model checkpoint saved to `~/.sia/models/fusion-head.onnx`.

**Heuristic fallback:** When fewer than 50 feedback events exist, the head runs in heuristic mode where attention weights are fixed to approximate `rrf * importance * confidence * trust_weight`.

**Dependencies:** Module 24 (model), Module 27 (feedback for training)

#### Module 27: Feedback Collection & Training

**Purpose:** Collect implicit and explicit developer feedback on retrieval results, and orchestrate fine-tuning of the Attention Fusion Head.

**Key files:** `src/feedback/collector.ts`, `src/feedback/store.ts`, `src/feedback/trainer-scheduler.ts`

**Key exports:** `FeedbackCollector`, `recordFeedback()`, `getFeedbackStats()`, `scheduleFinetuning()`

**Data flow:** Implicit feedback is captured from hooks: when the agent uses a retrieved entity (references it in tool calls, cites it in responses), that counts as a positive signal. When the agent ignores a retrieved entity or re-queries for the same topic, that counts as a negative signal. Explicit feedback comes from `sia_flag` annotations.

**Training schedule:** Fine-tuning triggers when feedback events exceed the last training count by 50+ events AND at least 24 hours have passed since the last training run. Training runs on the maintenance scheduler's idle cycle (Module 22).

**Schema:** `feedback_events` table with `query_id`, `node_id`, `signal` (positive/negative), `signal_source` (implicit/explicit), `t_created`.

**Dependencies:** Module 1 (storage), Module 14 (hooks for implicit feedback), Module 26 (fusion head to train)

#### Module 28: GLiNER Entity Extractor

**Purpose:** On-device Named Entity Recognition using GLiNER-small to extract typed entities from text without LLM calls.

**Key files:** `src/capture/gliner-extractor.ts`, `src/capture/entity-linker.ts`

**Key exports:** `GlinerExtractor`, `extractEntities()`, `linkEntitiesToGraph()`

**Data flow:** Integrated into the capture pipeline (Module 2) at Track A. When available (T2+), GLiNER runs on conversation text and documentation chunks. Extracts entities with type labels (person, library, API, service, technology, pattern). Extracted entities are matched against existing graph nodes by name similarity (Jaccard > 0.8) and semantic similarity (cosine > 0.7). Unmatched entities that pass ontology validation are added as `Concept` nodes with `pertains_to` edges.

**Availability:** Active at T2+ only. At T0-T1, entity extraction relies solely on Tree-sitter AST (Track A) and LLM extraction (Track B).

**Dependencies:** Module 24 (model availability), Module 2 (capture pipeline integration), Module 10 (ontology validation)

---

### Interface Layer (Modules 5, 16, 17, 23)

#### Module 5: MCP Server

**Purpose:** Expose 29 tools over stdio transport. Strictly read-only on the main graph.

**Key files:** `src/mcp/server.ts`, `src/mcp/tools/` (one file per tool)

**Security model:** Graph opened with `OPEN_READONLY`. Separate WAL-mode write connections for event nodes, `session_flags`, and `session_resume`. All inputs Zod-validated.

**29 tools:** 24 `sia_*` + 5 `nous_*`. Memory (`sia_search`, `sia_by_file`, `sia_expand`, `sia_community`, `sia_at_time`, `sia_flag`, `sia_note`, `sia_backlinks`), Sandbox (`sia_execute`, `sia_execute_file`, `sia_batch_execute`, `sia_index`, `sia_fetch_and_index`), Diagnostic (`sia_stats`, `sia_doctor`, `sia_upgrade`, `sia_sync_status`), Models (`sia_models`), AST (`sia_ast_query`), Branch Snapshots (`sia_snapshot_list`, `sia_snapshot_restore`, `sia_snapshot_prune`), Nous (`nous_state`, `nous_reflect`, `nous_curiosity`, `nous_concern`, `nous_modify`).

**Dependencies:** Modules 1, 4, 6, 9, 10

#### Module 16: Claude Code Plugin Layer

**Purpose:** Package Sia as a Claude Code plugin activating all five extension points (MCP, hooks, skills, agents, CLAUDE.md).

**Key files:** `.claude-plugin/plugin.json`, `.mcp.json`, `hooks/hooks.json`, `skills/`, `agents/`, `scripts/`

**Extension points:** MCP (`.mcp.json`, 29 tools), Hooks (`hooks/hooks.json`, real-time capture), Skills (`skills/*.md`, slash commands), Agents (`agents/*.md`, autonomous analysis), CLAUDE.md (behavioral directives). Plugin mode uses `CLAUDE_PLUGIN_DATA` for state; standalone uses `~/.sia/`.

**Dependencies:** Module 5 (MCP), Module 14 (hooks), Module 17 (CLAUDE.md generation)

#### Module 17: Auto-Integration Engine

**Purpose:** CLAUDE.md behavioral directives, task classification, and playbook system that make Claude use Sia automatically.

**Key files:** `src/agent/claude-md-template.md`, `src/agent/modules/` (playbooks)

**Task classification:** Keyword-based routing to bug-fix, feature, review, orientation, or trivial. Each type has a tool selection order (e.g., bug-fix: `sia_search` --> `sia_by_file` --> mandatory `sia_at_time`; feature: `sia_community` --> `sia_search` --> `sia_by_file`).

**Invariants:** Max 3 tools before starting work; max 2 `sia_expand`; never use Tier 4 as sole basis; always cite nodes that constrain decisions.

**Dependencies:** Module 5 (MCP tools), Module 14 (hooks)

#### Module 23: Graph Visualizer

**Purpose:** Browser-based D3.js interactive views of the knowledge graph.

**Key files:** `src/visualization/graph-renderer.ts`, `src/visualization/subgraph-extract.ts`, `src/visualization/template.html`, `scripts/visualizer.ts`

**Views:** Graph Explorer (force-directed), Timeline (temporal evolution), Dependency Map (hierarchical), Community Clusters (colored hulls). Launched via `npx sia graph`, serves self-contained HTML with inlined D3.js on port 4580.

**Dependencies:** Module 1 (storage), Module 3 (communities for cluster view)

---

### Security Layer (Module 6)

#### Module 6: Security Layer

**Purpose:** Prevent injection of false knowledge via malicious content (poisoned READMEs, crafted comments).

**Key files:** `src/security/pattern-detector.ts`, `src/security/semantic-consistency.ts`, `src/security/staging-promoter.ts`, `src/security/rule-of-two.ts`, `src/security/sanitize.ts`

**Staging pipeline:** Tier 4 content goes to `memory_staging` (no FK to main graph). Three sequential checks: (1) pattern detection (regex + keyword density for injection language), (2) semantic consistency (cosine distance from project centroid), (3) confidence threshold (Tier 4 requires >= 0.75 vs 0.60 for Tier 3).

**Rule of Two:** For Tier 4 ADDs, a Haiku security call provides independent second opinion. **Paranoid modes:** `paranoid: true` on query (weak, filters only) vs `paranoidCapture: true` in config (hard, quarantines all Tier 4 at chunker). **Audit:** Every write logged to `audit_log`. Daily snapshots; rollback via `npx sia rollback <timestamp>`.

**Dependencies:** Module 1 (storage), Module 15 (LLM for Rule of Two)

---

### Integration Layer (Modules 8, 9, 10, 11, 15, 21)

#### Module 8: Team Sync Layer

**Purpose:** Optional team synchronization via libSQL embedded replicas and HLC timestamps. Disabled by default.

**Key files:** `src/sync/hlc.ts`, `src/sync/client.ts`, `src/sync/push.ts`, `src/sync/pull.ts`, `src/sync/conflict.ts`, `src/sync/dedup.ts`, `src/sync/keychain.ts`

**HLC:** 64-bit value (48-bit physical time + 16-bit logical counter). Persisted to `hlc.json`.

**What syncs:** Team/project-visible nodes and edges, cross-repo edges. Private nodes never sync. Post-sync VSS refresh via direct bun:sqlite (server never runs sqlite-vss). Three-layer dedup (name match, embedding, LLM) tracked in `sync_dedup_log`.

**Conflict resolution:** Invalidation is sticky; new assertions run through consolidation; genuine contradictions flagged with `conflict_group_id`. Auth tokens stored in OS keychain via `@napi-rs/keyring`, never in config files.

**Dependencies:** Module 1 (storage), Module 15 (LLM for dedup Layer 3)

#### Module 9: Sandbox Execution Engine

**Purpose:** Isolated subprocess execution with Context Mode for large output.

**Key files:** `src/sandbox/executor.ts`, `src/sandbox/context-mode.ts`, `src/sandbox/credential-pass.ts`

**Runtimes:** Python, Node.js, Bun, Bash, Ruby, Go, Rust, Java, PHP, Perl, R.

**Context Mode:** When output > `contextModeThreshold` (5KB) and `intent` provided: chunk --> embed --> create ContentChunk nodes --> return top-K matching chunks. Achieves >95% context savings.

**Credential passthrough:** Inherits PATH, HOME, AWS_*, GOOGLE_*, GH_TOKEN, etc. Never stored or logged.

**Dependencies:** Module 1 (storage for ContentChunk nodes)

#### Module 10: Ontology Constraint Layer

**Purpose:** Validate all graph mutations before commit via declarative edge constraints.

**Key files:** `src/ontology/middleware.ts`, `src/ontology/constraints.ts`, `src/ontology/errors.ts`

**Core mechanism:** `edge_constraints` table declares valid `(source_kind, edge_type, target_kind)` triples. Adding a new relationship is an INSERT, not a code change.

**SQLite triggers:** `validate_edge_ontology` (reject invalid triples), `validate_supersedes_same_kind` (same-kind only), `guard_convention_pertains_to` (prevent removing last pertains_to).

**Application-layer enforcement:** Co-creation (`createBug()` requires `caused_by` target), cardinality (`createConvention()` requires `pertains_to` target), supersession validation.

**BFO-inspired design:** Continuants (CodeSymbol, FileNode, Convention) are invalidated, never deleted. Occurrents (EditEvent, Bug lifecycle) can be archived on decay.

**Dependencies:** Module 1 (storage)

#### Module 11: Knowledge and Documentation Engine

**Purpose:** Auto-discover, chunk, index, and track freshness of repository documentation.

**Key files:** `src/knowledge/discovery.ts`, `src/knowledge/ingest.ts`, `src/knowledge/external-refs.ts`, `src/knowledge/freshness.ts`, `src/knowledge/templates.ts`

**Discovery priorities:** (1) AI context (CLAUDE.md, AGENTS.md, .cursor/rules), (2) Architecture (ARCHITECTURE.md, ADRs), (3) Project (README, CONTRIBUTING), (4) API (OpenAPI, GraphQL), (5) Changelog. Hierarchical and JIT.

**Ingestion:** Heading-based chunking, code block preservation, internal link resolution, known symbol detection. Documents become FileNode with child ContentChunk nodes via `child_of` edges.

**External refs:** URLs to Notion, Confluence, Jira, etc. create `ExternalRef` marker nodes. No HTTP requests made.

**Template system:** `.sia/templates/<kind>.yaml` for structured knowledge entry (e.g., ADR template).

**Dependencies:** Module 1 (storage), Module 10 (ontology)

#### Module 15: Pluggable LLM Provider

**Purpose:** Handle operations hooks cannot: community summarization, deep validation, batch extraction, non-Claude-Code agent support.

**Key files:** `src/llm/provider-registry.ts`, `src/llm/schemas.ts`, `src/llm/reliability.ts`, `src/llm/circuit-breaker.ts`, `src/llm/cost-tracker.ts`, `src/llm/config.ts`

**Role-based providers:**

| Role | Purpose | Active in hooks mode |
|------|---------|---------------------|
| summarize | Community summaries | Yes |
| validate | Deep validation of LLM facts | Yes |
| extract | Knowledge extraction | No (hooks handle it) |
| consolidate | Graph consolidation | No (hooks handle it) |

**Reliability:** `reliableGenerateObject()` wraps all calls with retry (3x), fallback chain (Anthropic --> OpenAI --> Ollama), circuit breaker (opens at >50% failures), json-repair.

**Zod schemas:** Same `SiaExtractionResult` schema validates hook output and LLM output, making the capture source invisible to downstream consumers.

**Cost tracking:** Every call logged to `.sia/cost-log.jsonl`. Daily budget enforcement (warn at 80%, stop at 120%).

**Dependencies:** Vercel AI SDK (`@ai-sdk/anthropic`, `@ai-sdk/openai`), Zod

#### Module 21: Multi-Audience Intelligence Layer

**Purpose:** Transform the knowledge graph into role-specific insights for QA, PM, and tech lead audiences.

**Key files:** `agents/sia-qa-analyst.md`, `agents/sia-qa-regression-map.md`, `agents/sia-pm-briefing.md`, `agents/sia-pm-risk-advisor.md`, `agents/sia-lead-architecture-advisor.md`, `agents/sia-lead-team-health.md`

**QA:** Risk scoring (`bug_density * 0.40 + change_velocity * 0.35 + fan_out * 0.25`), regression mapping.

**PM:** Status narratives, blocker identification, timeline risk assessment. Maps Bug --> "known issues", Decision --> "architectural choices".

**Tech Lead:** Architecture drift detection (Convention violations), knowledge distribution analysis (bus factor per community cluster).

**Dependencies:** Module 1 (storage), Module 3 (communities), Module 4 (retrieval)

---

### Performance Layer (Module 13)

#### Module 13: Native Performance Module

**Purpose:** Optional Rust NAPI-RS module accelerating AST diffing and graph algorithms. No Rust toolchain required.

**Key files:** `src/native/bridge.ts`, `src/native/fallback-ast-diff.ts`, `src/native/fallback-graph.ts`, `sia-native/` (Rust crate)

**Three-tier fallback:** Rust native --> Wasm --> pure TypeScript. `bridge.ts` is the single import site.

**APIs:**
- `astDiff(oldTree, newTree, nodeIdMap)` -- GumTree matching, 5-20x speedup
- `graphCompute(edges, nodeIds, algorithm)` -- PageRank, shortest-path, betweenness centrality via petgraph
- `leidenCommunities(edges, nodeCount, resolutions)` -- graphrs Leiden at multiple resolutions

**Performance:** AST diff 5-20x faster in Rust; PageRank/Leiden sub-500ms for 50K nodes. NAPI-RS v3 builds for macOS/Linux/Windows (ARM64 + x64) + Wasm fallback. Each ~3-6MB.

**Dependencies:** None (provides acceleration to Modules 3, 12)

---

## Directory Layout

```
sia/
  src/
    graph/         # M1: SiaDb adapter, node/edge CRUD, migrations, session-resume
    workspace/     # M1: monorepo detection, API contracts, cross-repo
    capture/       # M2: pipeline, tracks A+B, consolidation, events, embedder
    ast/           # M2/18: language registry, indexer, extractors, watcher
    community/     # M3: Leiden, RAPTOR, summaries, scheduler
    retrieval/     # M4: search, vector, BM25, graph traversal, reranker, cross-encoder, fusion
    models/        # M24: tier manager, manifest, downloader, registry
    feedback/      # M27: collector, store, trainer scheduler
    mcp/           # M5: server.ts + tools/ (17 tool files)
    security/      # M6: pattern detection, staging, Rule of Two, sanitize
    decay/         # M7: decay formula, archiver, consolidation sweep, scheduler
    sync/          # M8: HLC, push/pull, conflict, dedup, keychain
    sandbox/       # M9: executor, context-mode, credential passthrough
    ontology/      # M10: middleware, constraints, errors
    knowledge/     # M11: discovery, ingest, external refs, templates
    freshness/     # M12: 5 layers, dirty tracker, cuckoo filter, firewall
    native/        # M13: bridge.ts + JS fallbacks
    hooks/         # M14: event router, handlers/, extractors/, adapters/
    llm/           # M15: provider registry, schemas, reliability, cost tracker
    agent/         # M17: CLAUDE.md template, playbook modules
    visualization/ # M23: D3.js renderer, subgraph extraction
    cli/           # CLI entry point + commands/
    shared/        # config.ts, types.ts, logger.ts, errors.ts
  migrations/      # SQL per database (graph/, meta/, bridge/, episodic/)
  skills/          # M16/19: slash-command skill files
  agents/          # M16/21: subagent definitions
  hooks/           # M16: hooks.json registration
  scripts/         # MCP entry, hook handler, visualizer server
  sia-native/      # M13: Rust NAPI-RS crate
  tests/           # Vitest tests with better-sqlite3 shim
```

---

## Data Flow Diagrams

### Write Path (Detailed)

```
Hook fires (PostToolUse / Stop / SessionStart / PreCompact)
    |
    +-- Parse payload --> resolve repo hash --> open SiaDb
    +-- Create event node (EditEvent, GitEvent, ...)
    |     +-- part_of edge --> SessionNode
    |     +-- precedes edge --> previous event
    +-- Assign trust tier (1-4)
    +-- Write chunks to episodic.db (unconditional)
    |
    +-------------------+
    v                   v
Track A (AST)     Track B (LLM)
~0ms/file         semantic extraction
CodeSymbol,       Decision, Convention,
FileNode          Bug, Solution, Concept
    |                   |
    +--------+----------+
             v
    Union CandidateFact[]
             |
    +--------+-----------+
    v                    v
Tier 1-3              Tier 4
  Ontology valid.       memory_staging
  2-phase consol.       (pattern detection +
  Edge inference        semantic consistency +
  Atomic batch write    confidence threshold +
  Audit log             Rule of Two)
             |
             v
    Post-write: session_flags, community trigger, sync push
```

### Read Path (Detailed)

```
MCP tool call (e.g. sia_search)
    |
    +-- Validate input (Zod schema)
    +-- Check progressive throttle (Normal / Reduced / Blocked)
    +-- Open graph.db read-only
    |
    v
Stage 1: Parallel Retrieval
    +-- Vector: ONNX embed --> sqlite-vss cosine (dual embeddings at T1+)
    +-- BM25: FTS5 MATCH with normalized rank
    +-- Graph: name lookup --> 1-hop expansion (root 1.0, neighbors 0.7)
    |
    v
Stage 2: Cross-Encoder Reranking  [T3 only; skipped at T0-T2]
    mxbai-rerank-base-v1 scores each (query, candidate) pair
    Prune candidates below dynamic threshold (mean - 0.5 * stddev)
    |
    v
Stage 3: Attention Fusion  [T1+; falls back to RRF at T0]
    SIA Attention Fusion Head merges signals into single relevance score
    (T0 fallback: rrf * importance * confidence * trust_weight * task_boost)
    |
    v
Stage 4: Trust-Weighted Output
    final = fused_score * trust_weight * importance_decay
    |
    v
Response Budget --> Context Assembly --> JSON response
```

### Branch Switch Flow

```
PostToolUse on "git checkout feature/auth"
  --> Save current branch: serialize active nodes+edges --> UPSERT branch_snapshots
  --> Restore target: lookup --> clear graph --> load snapshot --> rebuild indexes
      (first visit to branch: keep current graph)
```

### Session Lifecycle

```
SessionStart --> load session_resume (if resuming) --> re-query graph
             --> build Session Guide (15 subgraph queries) --> inject via stdout
     ... active session ...
PreCompact --> traverse SessionNode events (P1 first) --> serialize to session_resume (2KB)
     ... context compaction ...
SessionStart (resumed) --> restore + re-query + inject
```

### /sia-learn Pipeline

```
Phase 0: Auto-Install (verify databases, ONNX model, hooks)
Phase 1: Code Indexing (worker-threaded parse --> CodeSymbol, FileNode + edges)
Phase 2: Doc Ingestion (discover + chunk --> ContentChunk, ExternalRef + edges)
Phase 3: Community Detection (Leiden/Louvain --> Community nodes + summaries)
Phase 4: Summary Report (stats + markdown) --> save branch snapshot
```

---

## Key Design Decisions

**Why SQLite (not PostgreSQL/Neo4j).** Each `graph.db` has its own WAL lock -- concurrent agent sessions on different repos never block each other. Physical isolation: deleting a repo means deleting one directory. Schema migrations are per-repo. No server process needed. Cross-repo edges live in `bridge.db` ATTACHed on demand.

**Why bi-temporal (not event sourcing).** Superseded decisions are invalidated (`t_valid_until`), not deleted. This preserves historical record for `sia_at_time` while keeping current retrieval clean. The distinction between invalidation (superseded fact) and archival (decayed node) is load-bearing.

**Why hooks-first capture (not transcript analysis).** Claude Code is already the LLM doing the work. Making a separate API call to re-analyze what it already understood is architecturally redundant. PostToolUse hooks deliver full tool I/O at the moment it happens, for $0. Cost: ~$0.04/day vs ~$0.36/day with richer knowledge capture.

**Why embedded replicas for sync (not REST API).** The sync server (`sqld`) is a pure data relay -- it never interprets embeddings. Vector indexes are local-only, rebuilt from synced embedding BLOBs after each pull. No fragile server-side extension dependencies.

**Why worker threads (not child processes).** Workers share the same V8 heap for Tree-sitter grammars via MessageChannel. No serialization overhead for grammar objects. Workers are stateless -- they receive a file path, return CandidateFact[]. No database access in workers.

**Why progressive disclosure for skills (not monolithic prompts).** Task classification routes to playbook-specific guidance. The agent loads only the relevant playbook, keeping context lean. Skills are slash-command-invocable and auto-discovered from `skills/*.md`.

**Why a unified node table.** Single `graph_nodes` with `kind` discriminator enables uniform bi-temporal queries, consistent edge references, and a single FTS5/VSS index. `current_nodes` shadow table (trigger-maintained) eliminates temporal predicates from hot queries, reducing effective table size ~10x.

**Why Salsa-inspired dirty propagation.** If a source file changes but the derived fact is unchanged (whitespace edit), stop propagation immediately. Eliminates ~30% of unnecessary re-verification.

**Why tiered models (not all-or-nothing).** A full transformer stack (embeddings + cross-encoder + GLiNER + attention head) totals ~1.28 GB. Requiring this upfront would block adoption. Tiered activation lets users start with T0 (~57 MB) and get useful results immediately via classic RRF. Each tier adds capability with transparent tradeoffs. The lazy download design means disk cost is proportional to the features actually used.

**Why learned attention fusion (not static RRF).** Static RRF assigns fixed weights to retrieval signals regardless of project characteristics. In practice, the optimal weighting varies: some codebases benefit more from graph proximity (tightly coupled modules), others from BM25 (well-named symbols), and others from vector similarity (conceptual queries). A learned fusion head adapts to the project through developer feedback. IPS-style bias correction (Agarwal et al., 2019) prevents the training from overfitting to trust-tier presentation order.

**Why dual embedders (not a single model).** Natural language queries ("how does authentication work") and code queries ("UserService.authenticate signature") occupy different embedding spaces. A single model compromises on both. bge-small excels at semantic similarity in prose; jina-code was trained on code-text pairs and understands identifier semantics, camelCase splitting, and API patterns. The query classifier routes automatically, so the developer never needs to think about which model to use.

---

## Configuration Reference

### SiaConfig (config.json)

Key configuration groups with defaults (see `src/shared/config.ts` for full interface):

| Group | Key Fields | Defaults |
|-------|-----------|----------|
| Storage | `repoDir`, `modelPath`, `astCacheDir`, `snapshotDir`, `logDir` | All under `~/.sia/` |
| Capture | `captureModel`, `minExtractConfidence`, `stagingPromotionConfidence` | `claude-haiku-4-5`, 0.6, 0.75 |
| Decay | `decayHalfLife.{Decision,Convention,Bug,Solution,default}`, `archiveThreshold` | 90/60/45/45/30 days, 0.05 |
| Retrieval | `maxResponseTokens`, `workingMemoryTokenBudget` | 1500, 8000 |
| Community | `communityTriggerNodeCount`, `communityMinGraphSize` | 20, 100 |
| Security | `paranoidCapture`, `enableFlagging`, `airGapped` | false, false, false |
| Maintenance | `maintenanceInterval`, `idleTimeoutMs`, `deepValidationRateMs` | 24h, 60s, 5s |
| Sandbox | `sandboxTimeoutMs`, `contextModeThreshold`, `contextModeTopK` | 30s, 10KB, 5 |
| Throttle | `throttleNormalMax`, `throttleReducedMax` | 3, 8 |
| Tree-sitter | `treeSitter.{enabled,preferNative,parseTimeoutMs,maxCachedTrees}` | true, true, 5000, 500 |
| Sync | `sync.{enabled,serverUrl,developerId,syncInterval}` | false, null, null, 30s |

### Provider Configuration (sia.config.yaml)

Capture mode and LLM providers are configured separately from `config.json`:

```yaml
capture:
  mode: hooks              # hooks | api | hybrid
  hookPort: 4521
providers:
  summarize: { provider: anthropic, model: claude-sonnet-4 }
  validate:  { provider: ollama, model: qwen2.5-coder:7b }
  extract:   { provider: anthropic, model: claude-haiku-4-5 }
  consolidate: { provider: anthropic, model: claude-haiku-4-5 }
fallback:
  chain: [anthropic, openai, ollama]
costTracking:
  budgetPerDay: 1.00
```

### Path Aliases

Configured in `tsconfig.json`:

```
@/graph/*      --> src/graph/*
@/capture/*    --> src/capture/*
@/ast/*        --> src/ast/*
@/retrieval/*  --> src/retrieval/*
@/mcp/*        --> src/mcp/*
@/security/*   --> src/security/*
@/sync/*       --> src/sync/*
@/decay/*      --> src/decay/*
@/cli/*        --> src/cli/*
@/shared/*     --> src/shared/*
@/workspace/*  --> src/workspace/*
@/agent/*      --> src/agent/*
```

---

## Testing

**Framework:** Vitest 4.x running in Node.js (not Bun) with a `better-sqlite3` shim.

**bun:sqlite shim:** `tests/__mocks__/bun-sqlite.ts` re-exports better-sqlite3. The `vitest.config.ts` alias maps `bun:sqlite` to this shim, allowing graph code to run unchanged in Node.js.

**Temp directory pattern:** Tests create temp directories for database files. `afterEach` hooks clean them up. Use `openGraphDb(repoHash, tempDir)` to get a db with full schema.

**Commands:**

```bash
bun run test              # Run unit tests (vitest)
bun run test:unit         # Same as above
bun run test:integration  # Integration tests
bun run lint              # Check lint (Biome 2.x)
bun run lint:fix -- --unsafe  # Auto-fix lint
bun run typecheck         # TypeScript type checking (tsc --noEmit)
```
