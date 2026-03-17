# Implementation Tasks
## Sia v5 — Engineering Backlog & Delivery Plan

**Version:** 5.0
**Status:** Draft
**Last Updated:** 2026-03-14
**Changelog from v4.2:** Complete restructuring for unified graph architecture. Phase 1 now includes unified graph schema (replaces four separate schemas). Phase 4 adds event node creation and session continuity engine. New Phase 5: Sandbox Execution Tools (sia_execute, sia_execute_file, sia_index, sia_batch_execute, sia_fetch_and_index, sia_stats, sia_doctor, sia_upgrade). Session continuity hooks (PostToolUse graph writes, PreCompact subgraph serialization, SessionStart subgraph deserialization) integrated into Phase 4. All task acceptance criteria updated for graph_nodes/graph_edges tables. SiaDb adapter carries R8/R9 fixes (atomic executeMany, reentrancy guard, write-mode batch). DELETE trigger on edges for edge_count maintenance. HLC overflow guard. SiaCommunityResult wrapper. Progressive throttling. Response budget enforcement.

---

## How to Read This Document

Tasks are organized into phases representing shippable milestones. The **critical path** is Phases 1 → 2 → 3 → 4 → 5. All other phases can proceed in parallel once Phase 5 is complete, with the exception that Phase 8 Task 8.5 must be built on top of Phase 6 Task 6.5 (both modify `sia-search.ts`).

**Estimated total: 280–360 hours.** Critical path (Phases 1–5): **130–168h**.

---

## Phase 1 — Unified Graph Storage Foundation
**Goal:** graph.db with unified schema, meta.db, bridge.db, CRUD layers, SiaDb adapter, migration infrastructure, CLAUDE.md spec.
**Estimated effort:** 52–68 hours

---

**Task 1.1 — Project scaffold and tooling** [BLOCKING] — *4–5h*

Initialize repository: Bun runtime, TypeScript strict mode, path aliases, Biome linting, Vitest. Create full directory tree from ARCHI §13. Set up `npx sia` binary entry.

Acceptance criteria: `bun run test` passes, `bun run lint` passes, `npx sia --version` prints version.

---

**Task 1.2 — Migration runner and SQLite connection factory** [BLOCKING] — *3–4h*

Migration runner for three database files (meta.db, bridge.db, graph.db). Every write connection: `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;`. Load sqlite-vss on graph.db connections only.

Acceptance criteria: All three databases open cleanly, migrations apply exactly once, sqlite-vss loads and accepts 384-dim insert.

---

**Task 1.3 — meta.db full schema** [BLOCKING] — *2–3h*

`migrations/meta/001_initial.sql`: `repos`, `workspaces`, `workspace_repos`, `api_contracts`, `sync_config`, `sync_peers`, `sharing_rules`.

Acceptance criteria: Schema applies, FK constraints work, `sharing_rules` present in meta.db.

---

**Task 1.4 — bridge.db schema** — *1–2h*

`migrations/bridge/001_initial.sql`: `cross_repo_edges` with full bi-temporal columns, HLC columns, partial indexes.

Acceptance criteria: Schema applies, all bi-temporal columns present, partial indexes created.

---

**Task 1.5 — graph.db unified schema** [BLOCKING] — *6–8h*

`migrations/graph/001_initial.sql`: complete unified schema from ARCHI §2.4. Critical items:

- `graph_nodes` table with `kind` discriminator, all bi-temporal columns, session_id, priority_tier, properties JSON
- `graph_edges` table with all structural + semantic + event + session edge types
- FTS5 virtual table + 3 sync triggers (AI, AD, AU)
- VSS virtual table
- 4 edge_count maintenance triggers (insert, invalidate, reactivate, DELETE)
- `communities`, `community_members`, `summary_tree`
- `memory_staging` (no FK to graph_nodes)
- `session_flags`, `session_resume`, `sessions_processed`
- `audit_log`, `local_dedup_log`, `sync_dedup_log`, `search_throttle`

Acceptance criteria: Schema applies. `graph_nodes` has kind, all 4 bi-temporal columns, session_id, priority_tier. FTS5 triggers keep `graph_nodes_fts` in sync. All 4 edge_count triggers work: (a) insert active edge → count increments on both endpoints; (b) invalidate edge → decrements; (c) reactivate edge → increments back; (d) hard-delete active edge → decrements (DELETE trigger). `memory_staging` has no FK to `graph_nodes`. `session_resume` stores subgraph JSON. `local_dedup_log` and `sync_dedup_log` distinct schemas.

---

**Task 1.6 — Node CRUD layer** [BLOCKING] — *5–6h*

`src/graph/nodes.ts`: `insertNode`, `getNode`, `updateNode`, `touchNode`, `invalidateNode(db, id, tValidUntil)` (sets both t_valid_until AND t_expired), `archiveNode` (archived_at only), `getActiveNodes` (WHERE t_valid_until IS NULL AND archived_at IS NULL), `getNodesBySession(sessionId)`, `getNodesByKind(kind)`.

Acceptance criteria: Full CRUD round-trip, invalidateNode sets both temporal columns + audit log, archiveNode doesn't touch temporal columns, getNodesBySession returns only nodes with matching session_id.

---

**Task 1.7 — Edge CRUD layer** [BLOCKING] — *3–4h*

`src/graph/edges.ts`: `insertEdge`, `invalidateEdge`, `getActiveEdges`, `getEdgesAsOf`, `getEdgesByType(fromId, types)`.

Acceptance criteria: Insert → invalidate → getActiveEdges empty, getEdgesAsOf returns edge at past timestamp.

---

**Task 1.8 — Cross-repo edge CRUD** — *2–3h*

`src/graph/bridge-db.ts` and `src/workspace/cross-repo.ts`. No WAL on read-only ATTACH connections.

Acceptance criteria: Cross-repo edge round-trip, ATTACH helper works, no PRAGMA journal_mode on readonly.

---

**Task 1.9 — Workspace and repo registry CRUD** [BLOCKING] — *2–3h*

`src/graph/meta-db.ts`: registerRepo, createWorkspace, addRepoToWorkspace, resolveWorkspaceName, getSharingRules.

Acceptance criteria: Idempotent registration, name→UUID resolution works.

---

**Task 1.10 — Session resume CRUD** — *2–3h*

`src/graph/session-resume.ts`: `saveSubgraph(sessionId, subgraphJson, lastPrompt, budget)`, `loadSubgraph(sessionId)`, `deleteResume(sessionId)`.

Acceptance criteria: Round-trip save/load, subgraph JSON parses to valid node/edge arrays, budget_used tracked.

---

**Task 1.11 — Audit log, flags, sessions_processed** — *2–3h*

`src/graph/audit.ts`: append-only. `src/graph/flags.ts`: session_flags CRUD. `sessions_processed` CRUD.

Acceptance criteria: 1000 audit writes succeed, all operation types accepted, sessions_processed tracks status.

---

**Task 1.12 — Config loading** — *2–3h*

Load `~/.sia/config.json`, apply defaults, merge per-workspace overrides. Validate decayHalfLife keys. Reject "Architecture" type. Load additionalLanguages. Include sandbox config (sandboxTimeout, contextModeThreshold, maxChunkSize), throttle config, event decay half-life.

Acceptance criteria: Missing keys return defaults, sandbox config validated, additionalLanguages merged.

---

**Task 1.13 — Unified SiaDb adapter** [BLOCKING] — *6–8h*

Implement ARCHI §2.7. BunSqliteDb.executeMany atomic (BEGIN/COMMIT/ROLLBACK). LibSqlDb.executeMany uses `"write"` batch mode. Reentrancy guard on BunSqliteDb.transaction(). Nested transaction() throws in both adapters.

Acceptance criteria: BunSqliteDb.executeMany rolls back on mid-batch failure. LibSqlDb.executeMany passes N=10 concurrency test with zero SQLITE_BUSY. Calling execute() during active transaction() throws clear error. Nested transaction() throws.

---

**Task 1.14 — CLAUDE.md behavioral specification** [BLOCKING] — *5–7h*

Write modular behavioral spec: base module (~1,800 tokens) + contextual playbooks. Base module contains task classifier (now includes sandbox tool routing), Step 0 module loading, Step 2 safety layer, invariants. Modules: sia-regression.md, sia-feature.md, sia-review.md, sia-orientation.md, sia-tools.md, sia-flagging.md.

Invariant 1 now has three exceptions: regression (4 tools), feature (4 tools with sia_expand), review (per-file sia_by_file exempt).

Acceptance criteria:
- **Scenario 0 (module loading):** Feature request → agent reads sia-feature.md before any Sia tool call. First Sia call is sia_community.
- **Scenario A (feature):** "Add a rate limiter" → agent calls sia_community then sia_search(task_type='feature') then sia_by_file for existing files. Cites entities.
- **Scenario B (regression):** "Payment service is slow" → sia_search(bug-fix) AND sia_at_time. Compares outputs.
- **Scenario C (orientation):** "Explain the architecture" → sia_community(level=2). Narrative response.
- **Scenario D (review):** "Review this PR" → sia_search(review, Convention, limit=15). Cites entity IDs.
- **Scenario E (conflict halt):** conflict_group_id set → agent STOPS, presents both facts.
- **Scenario F (trust verification):** Tier 3 entity → agent qualifies as hypothesis, verifies.
- **Scenario G (sandbox routing):** "Analyze this log file" → agent uses sia_execute or sia_execute_file, not cat. Raw data stays out of context.
- **Scenario H (bootstrapping):** global_unavailable:true → agent explains, falls back to sia_search.

---

## Phase 2 — Local ONNX Embedder
**Goal:** On-device embedding. Zero network dependency.
**Estimated effort:** 8–10 hours

Tasks 2.1–2.3: Model download, ONNX session + tokenizer, embedding cache + paranoid flag. Same as v4.2.

---

## Phase 3 — MCP Server (Read Path)
**Goal:** All 14 MCP tools registered and connected. Graph empty but integration works end-to-end.
**Estimated effort:** 24–30 hours

---

**Task 3.1 — MCP server scaffold** [BLOCKING] — *3–4h*

Opens graph.db READONLY via SiaDb. Opens separate write connection for event nodes, session_flags, and session_resume (WAL mode). Registers all 14 tool handlers. Health-check port.

Acceptance criteria: Server starts, all tools registered, READONLY connections confirmed, WAL on write connection, concurrent read + event-write doesn't conflict.

---

**Task 3.2 — sia_search** [BLOCKING] — *4–5h*

Simplified vector-only for Phase 3 (full pipeline in Phase 8). Returns SiaSearchResult[] with all fields including t_valid_until (null for active). source_repo_id/name omitted for non-workspace queries. maxResponseTokens enforcement: whole nodes or nothing, truncated flag. Progressive throttling: track call count per session via search_throttle table.

Acceptance criteria: Results on non-empty graph. Empty graph → empty array. Workspace includes source_repo. Non-workspace omits source_repo. Paranoid excludes Tier 4. conflict_group_id, t_valid_from, t_valid_until populated. maxResponseTokens: 10 nodes × 200 tokens each, budget 1500 → 7 nodes + truncated:true. Throttle: 4th call returns reduced results + warning.

---

**Task 3.3 — sia_by_file** — *2–3h*

Traverses from FileNode through all connected edges. Returns SiaSearchResult[].

Acceptance criteria: Returns decisions, conventions, bugs connected to file. Workspace mode includes cross-repo edges.

---

**Task 3.4 — sia_expand** — *2–3h*

BFS from node, active edges only, configurable depth, 50-node cap, edge_count for truncation signal.

Acceptance criteria: Depth-1 returns direct neighbors. 50-cap enforced. edge_count > edges.length signals truncation.

---

**Task 3.5 — sia_at_time** — *3–4h*

Bi-temporal filter on both nodes and edges. invalidated_nodes[] with t_valid_until populated (non-null). invalidated_count for truncation detection. edge_count for edge truncation.

Acceptance criteria: Invalidated node at timestamp T appears in invalidated_nodes[] with t_valid_until == T. Insert 30 invalidated, limit 20 → length 20, count 30. Sorted t_valid_until DESC.

---

**Task 3.6 — sia_community** — *2–3h*

Returns SiaCommunityResult wrapper. global_unavailable in wrapper object (not array property). Up to 3 CommunitySummary objects.

Acceptance criteria: Graph < 100 nodes → { communities: [], global_unavailable: true }. 100+ nodes, no match → { communities: [] }. global_unavailable on wrapper, not on array.

---

**Task 3.7 — sia_flag** — *1–2h*

Sanitize (strip injection chars), truncate to 100 chars, insert to session_flags.

Acceptance criteria: Disabled by default, injection chars stripped, empty-after-strip returns error.

---

**Task 3.8 — sia_execute** [BLOCKING] — *5–6h*

Subprocess spawning for 11 runtimes. Stdout capture. Intent-based Context Mode (chunk, embed, index as ContentChunk nodes, return matching chunks). Credential passthrough for gh/aws/gcloud/kubectl/docker.

Acceptance criteria: Python script returns stdout. 50 KB output + intent → only relevant chunks returned, full output indexed as ContentChunk nodes with produced_by edges. Context saved: raw 50 KB → returned < 2 KB. Credential passthrough: `gh api /user` succeeds when gh is authenticated.

---

**Task 3.9 — sia_execute_file** — *2–3h*

Like sia_execute but mounts file into sandbox. Raw content never enters context.

Acceptance criteria: Processing 10 MB file returns structured result < 500 bytes. File content not in context.

---

**Task 3.10 — sia_index** — *3–4h*

Chunk markdown by headings (code blocks intact). Create ContentChunk nodes with embeddings. FTS5 indexing. Cross-reference to known CodeSymbol/FileNode via references edges.

Acceptance criteria: 10-heading markdown → 10 ContentChunk nodes. Code blocks not split. Mention of known function name → references edge created.

---

**Task 3.11 — sia_batch_execute** — *3–4h*

Execute multiple commands + searches in one call. Atomic event node creation. precedes edges between events.

Acceptance criteria: 3 commands + 2 searches in one call. Results array correct. precedes edges link events in order. Context savings: 3 separate calls would cost X bytes, batch costs 0.4X.

---

**Task 3.12 — sia_fetch_and_index** — *3–4h*

Fetch URL, detect content type (HTML→markdown, JSON→structured, text→direct). Chunk and index as ContentChunk nodes with trust_tier:4.

Acceptance criteria: HTML page → markdown → chunks with tier 4. JSON → structured extraction. Raw page not in context.

---

**Task 3.13 — sia_stats** — *1–2h*

Graph metrics: nodes by kind, edges by type, context savings (session + total), search/execute call counts.

Acceptance criteria: Accurate counts for test graph.

---

**Task 3.14 — sia_doctor** — *2–3h*

Check runtimes, hooks, FTS5, sqlite-vss, ONNX model, graph integrity (orphan edges, bi-temporal invariants).

Acceptance criteria: Missing Python runtime → warn. Orphan edge detected → reported. Healthy install → all OK.

---

**Task 3.15 — sia_upgrade** — *2–3h*

Fetch latest, rebuild, reconfigure hooks, run migrations, rebuild VSS if schema changed.

Acceptance criteria: Version bump succeeds. Hooks reconfigured. VSS rebuilt after schema migration.

---

**Task 3.16 — Installer** [BLOCKING] — *4–5h*

`npx sia install`: detect Claude Code, write MCP config (14 tools), register hooks (PostToolUse, Stop, UserPromptSubmit, PreCompact, SessionStart), init databases, download ONNX, detect monorepo, write CLAUDE.md.

Acceptance criteria: Clean install completes, all databases exist, all 14 tools registered, all hooks installed, CLAUDE.md written.

---

## Phase 4 — Capture Pipeline + Session Continuity
**Goal:** Full write path + event node creation + session continuity hooks.
**Estimated effort:** 38–48 hours

---

**Task 4.1 — Hook entry point and chunker** [BLOCKING] — *3–4h*

Parse payload, resolve repo hash, assign trust tier, paranoidCapture quarantine. Create event nodes for each hook event (EditEvent, GitEvent, etc.).

Acceptance criteria: Hook processes sample payload. Events created as graph nodes with correct kind, priority_tier, and session edges.

---

**Task 4.2 — Track A: Structural extraction** [BLOCKING] — *8–10h*

Language registry dispatch. Creates CodeSymbol nodes with defines edges to FileNode nodes. imports, calls, depends_on edges.

Acceptance criteria: TypeScript file → CodeSymbol nodes. All extractors per ARCHI. Unknown extensions → empty array.

---

**Task 4.3 — Track B: LLM semantic extraction** [BLOCKING] — *5–6h*

Haiku extraction. CandidateFact[] with kind field (not type). airGapped → empty array.

Acceptance criteria: Decision extracted. airGapped → zero HTTP calls.

---

**Task 4.4 — Two-phase consolidation** [BLOCKING] — *6–8h*

ADD/UPDATE/INVALIDATE/NOOP. invalidateNode sets t_valid_until AND t_expired. Atomic transaction. airGapped → direct-write for Track A candidates.

Acceptance criteria: Contradictory candidate → invalidate old + ADD new. Both exist with correct temporal fields. Atomic rollback on failure.

---

**Task 4.5 — Edge inference with pertains_to** — *4–5h*

Infer edges between new semantic nodes and existing structural nodes. Key addition: `pertains_to` edges connecting Decision/Convention/Bug nodes to the specific CodeSymbol and FileNode nodes they concern. This replaces the legacy file_paths JSON array with structural graph connections.

Acceptance criteria: Decision about AuthService → pertains_to edge → AuthService CodeSymbol node.

---

**Task 4.6 — Event node writer** — *3–4h*

`src/capture/event-writer.ts`. Creates typed event nodes for every hook event. Connects: part_of → SessionNode, precedes → previous event, kind-specific edges (modifies, triggered_by, references, etc.).

Acceptance criteria: File edit → EditEvent with modifies → FileNode. Error after execution → ErrorEvent with triggered_by → ExecutionEvent.

---

**Task 4.7 — PreCompact handler** — *3–4h*

Serialize priority-weighted subgraph: traverse SessionNode → part_of → events, sort by importance, serialize nodes + edges in order until 2 KB budget. Store in session_resume.

Acceptance criteria: Session with 50 events serialized to ≤ 2 KB. P1 events always included. P4 events dropped first when budget tight. Subgraph JSON parseable.

---

**Task 4.8 — SessionStart handler** — *3–4h*

Deserialize subgraph. Re-query graph for current state of serialized nodes. Build Session Guide via 15 subgraph queries (ARCHI §7.2). Inject session_knowledge directive.

Acceptance criteria: After compaction, model receives Session Guide with last prompt, active tasks, modified files, unresolved errors. Files modified after snapshot show updated state.

---

**Task 4.9 — UserPromptSubmit handler** — *2–3h*

Create UserDecision nodes for corrections/preferences. Create UserPrompt nodes for all messages. References edges to mentioned entities.

Acceptance criteria: "use X instead of Y" → UserDecision node with references edges to relevant nodes.

---

---

## Phase 5 — Sandbox Execution Engine
**Goal:** Isolated subprocess execution, Context Mode, credential passthrough.
**Estimated effort:** 12–16 hours

---

**Task 5.1 — Subprocess executor** [BLOCKING] — *4–5h*

`src/sandbox/executor.ts`. Spawn isolated subprocess per language. Capture stdout/stderr. Timeout enforcement. Auto-detect language from content/shebang. Bun fast-path for JS/TS.

Acceptance criteria: All 11 runtimes execute. Timeout kills subprocess. Bun detected and used for .ts files.

---

**Task 5.2 — Context Mode** [BLOCKING] — *4–5h*

`src/sandbox/context-mode.ts`. When output > contextModeThreshold and intent provided: chunk by lines/paragraphs, embed each chunk, create ContentChunk nodes with produced_by edges, search by intent embedding similarity, return top-K matching chunks.

Acceptance criteria: 50 KB output + intent "OOM errors" → 3 relevant chunks returned. Full output indexed as 50+ ContentChunk nodes. Context saved > 95%.

---

**Task 5.3 — Credential passthrough** — *2–3h*

`src/sandbox/credential-pass.ts`. Inherit PATH, HOME, AWS_*, GOOGLE_*, KUBECONFIG, DOCKER_*, GH_TOKEN etc. into subprocess environment. Never store or log credentials.

Acceptance criteria: `gh api /user` works in sandbox when gh authenticated. AWS_PROFILE inherited.

---

**Task 5.4 — Progressive throttling** — *2–3h*

`src/retrieval/throttle.ts`. Track call count per session in search_throttle. Normal (1–3), reduced (4–8), blocked (9+). Reset on new session.

Acceptance criteria: 3rd call → normal. 5th call → reduced + warning. 10th call → blocked + redirect to sia_batch_execute.

---

## Phase 6 — Workspace & Multi-Repo
**Estimated effort:** 18–24 hours

Same scope as v4.2 Phase 5: manifest parsing, API contract detection, workspace search, language registry. Task 6.5 (`workspace: true` on sia_search) must complete before Phase 8 Task 8.5.

---

## Phase 7 — AST Backbone
**Estimated effort:** 14–18 hours

Same scope as v4.2 Phase 6: full-repo indexer, incremental watcher, PageRank scoring, reindex CLI. Now creates CodeSymbol, FileNode, PackageNode graph nodes with defines/imports/calls/depends_on/contains edges.

---

## Phase 8 — Full Hybrid Retrieval
**Estimated effort:** 16–20 hours

Same scope as v4.2 Phase 7 plus graph-structural signal and proximity scoring. Three-stage pipeline: vector + BM25 + graph traversal → graph-aware expansion → RRF with trust weighting + graph proximity boost. Task 8.5 must build on Phase 6 Task 6.5.

---

## Phase 9 — Community Detection & RAPTOR
**Estimated effort:** 16–20 hours

Same scope as v4.2 Phase 8: Leiden, community summaries with invalidation tracking, RAPTOR summary tree.

---

## Phase 10 — Security Layer
**Estimated effort:** 14–18 hours

Same scope as v4.2 Phase 9: staging, pattern detection, semantic consistency, Rule of Two, paranoid mode, snapshot rollback with mandatory VSS rebuild.

---

## Phase 11 — Team Sync
**Estimated effort:** 25–32 hours

Same scope as v4.2 Phase 10: HLC with overflow guard, @napi-rs/keyring, libSQL factory, push/pull, conflict detection, three-layer dedup, server CLI. HLC overflow: logical counter > 0xFFFF → advance physical clock + reset counter.

---

## Phase 12 — Decay, Lifecycle, Flagging
**Estimated effort:** 16–20 hours

Expanded from v4.2 Phase 11: importance decay now covers event nodes with 1-hour half-life. Archival threshold for events: 7 days (vs 90 for semantic). Session event promotion via direct connection to graph.db (no double-qualifier — query sessions_processed directly). Bridge edge orphan cleanup. sia_flag enable/disable with template swap. Sharing rules enforcement.

---

## Phase 13 — Robustness, Export/Import, Docs
**Estimated effort:** 12–16 hours

Same scope as v4.2 Phase 12: export/import, integration test suite (now covering sandbox tools and session continuity), error handling audit, documentation.

---

## Phase 14 — Knowledge Authoring, Ontology Layer & Documentation Ingestion
**Goal:** Developer-authored knowledge, ontology-driven graph constraints, auto-discovery and ingestion of repository documentation (CLAUDE.md, AGENTS.md, README.md, ADRs, etc.), graph visualization, backlinks, knowledge digest, and markdown export. This phase transforms Sia from a passive capture system into an active knowledge platform where developers can write, explore, validate, and export knowledge — and where the graph itself enforces structural correctness through ontological constraints.
**Estimated effort:** 52–68 hours
**Dependency:** Requires Phases 1–5 complete (unified graph, MCP server, capture pipeline, sandbox engine). Independent of Phases 6–13. Can begin in parallel with those phases.
**Full specification:** See `SIA_PHASE14_IMPLEMENTATION.md` for complete task details, acceptance criteria, ontology schema, discovery rules, and architectural decisions.

---

**Task 14.1 — Ontology constraint layer** [BLOCKING] — *8–10h*

Implement the ontology enforcement system that validates all graph mutations before they commit. This is the foundation for everything else in Phase 14 — without it, developer-authored knowledge and auto-ingested documentation enter the graph without structural validation, allowing the same category of errors that ontology-grounded systems eliminate (63% → 1.7% hallucination reduction in comparable domains).

Create `edge_constraints` metadata table defining all valid (source_kind, edge_type, target_kind) triples. Implement universal BEFORE INSERT trigger on `graph_edges` that validates every edge against the constraints table. Implement type-matching trigger for `supersedes` edges (same-kind only). Implement Pydantic-based ontology middleware (`src/ontology/middleware.ts`) exposing typed factory methods (create_bug, create_decision, create_convention) that enforce co-creation constraints (Bug must have caused_by edge) and cardinality constraints (Convention must have ≥1 pertains_to edge) via transactional wrappers. Implement deletion guard preventing removal of a Convention's last pertains_to edge.

Acceptance criteria: Inserting an edge with an invalid (source_kind, edge_type, target_kind) triple is rejected by the SQLite trigger with a clear error message. Creating a Bug without a caused_by edge via the typed factory throws a validation error. Creating a Convention without a pertains_to edge throws. Attempting to supersede a Decision with a Bug throws (kind mismatch). Deleting the last pertains_to edge from a Convention throws. Direct SQL bypass of the middleware is caught by the SQLite trigger layer. All valid triples from ARCHI §2.4 pass validation. Performance: < 1ms overhead per validated operation.

---

**Task 14.2 — Repository documentation auto-discovery** [BLOCKING] — *6–8h*

Implement `src/knowledge/discovery.ts` — a priority-ordered file scanner that discovers documentation files in the repository and ingests them into the graph as Tier 1 (developer-authored) knowledge nodes. Discovery runs at install time (`npx sia install`), at reindex time (`npx sia reindex`), and incrementally via the file watcher.

Scan priority order: AI context files (AGENTS.md, CLAUDE.md, GEMINI.md, .cursor/rules/*.mdc, .windsurf/rules/*.md, .clinerules/*.md, .github/copilot-instructions.md, .amazonq/rules/*.md) → Architecture docs (ARCHITECTURE.md, docs/adr/*.md, DESIGN.md) → Project docs (README.md, CONTRIBUTING.md, CONVENTIONS.md, CONTEXT.md) → API docs (openapi.yaml, swagger.json, schema.graphql, API.md) → Change history (CHANGELOG.md, HISTORY.md). Discovery is hierarchical and JIT: root-level docs loaded at install, subdirectory docs loaded when the agent accesses files in that subtree.

Each discovered file becomes a `DocumentNode` (a FileNode subkind) with child `ContentChunk` nodes created via heading-based chunking (Task 14.3). AI context files (AGENTS.md, CLAUDE.md, etc.) are tagged `["ai-context"]` and given `trust_tier: 1` (developer-authored). Standard documentation (README.md, ARCHITECTURE.md) gets `trust_tier: 1`. External-origin content discovered via `sia_fetch_and_index` retains `trust_tier: 4`.

For monorepos: per-package documentation is scoped to its package via `package_path`. Root-level documentation applies to all packages. Cross-package references (one package's docs mentioning another package's symbols) generate `references` edges across package boundaries.

Acceptance criteria: `npx sia install` on a repo with AGENTS.md, README.md, docs/adr/001.md, and packages/auth/README.md discovers all four files. AGENTS.md ingested as trust_tier 1 with tag ai-context. Package-scoped README correctly scoped. Reindex discovers newly added ADRs. File watcher detects changes to existing docs and re-ingests. Files matching .gitignore are excluded. Discovery completes in < 2 seconds for repos with ≤ 50 documentation files.

---

**Task 14.3 — Documentation chunking and graph ingestion** — *4–5h*

Implement `src/knowledge/ingest.ts` — heading-based chunking with element-aware extraction. For each discovered documentation file: parse YAML frontmatter as node metadata, split at heading boundaries preserving heading hierarchy as metadata on each chunk, extract code blocks as separate entities with language tags, keep lists intact within their heading-scoped chunks, resolve internal links (relative paths between markdown files) as `references` edges, detect mentions of known CodeSymbol and FileNode names and create `references` edges.

Attach git metadata (last modified date, author via `git blame`) to each DocumentNode as freshness provenance. When a document's git modification date is significantly older than the code it describes (> 90 days divergence), tag the DocumentNode with `["potentially-stale"]` and surface this in search results.

Acceptance criteria: A 10-heading ARCHITECTURE.md produces 10 ContentChunk nodes with correct heading hierarchy metadata. Code blocks extracted with language tags. Internal link `[see auth docs](../auth/README.md)` creates a references edge to the auth README's DocumentNode. Mention of known function `AuthService.validate()` in prose creates a references edge to the CodeSymbol. Git metadata attached. Stale detection: doc modified 6 months ago describing code modified last week gets potentially-stale tag.

---

**Task 14.4 — External reference detection and optional ingestion** — *3–4h*

Implement `src/knowledge/external-refs.ts` — detect URLs in documentation pointing to external resources (Notion, Confluence, Google Docs, Jira/Linear, generic URLs). Do NOT auto-follow external links — instead, create `ExternalRef` marker nodes in the graph with the URL, detected service type, and a `trust_tier: 4` flag. The developer can optionally ingest external content via `sia_fetch_and_index` (which already handles URL fetching with Tier 4 trust).

For llms.txt discovery: when an external URL points to a documentation site, check for `/llms.txt` at that domain and suggest it as a cleaner ingestion path.

Acceptance criteria: README.md containing `https://notion.so/team/auth-spec-123` creates an ExternalRef node with service_type "notion". No HTTP requests made during discovery (detection is regex-based on URLs in markdown). Developer can run `sia_fetch_and_index` on the ExternalRef URL to ingest content. llms.txt suggestion surfaced when available.

---

**Task 14.5 — `sia_note` MCP tool** — *4–5h*

Implement developer-authored knowledge entry. The developer (or agent on their behalf) creates a Tier 1 node with authored content, explicit tags, and explicit edges to related nodes. Supports all semantic node kinds (Decision, Convention, Bug, Solution, Concept). Content is validated through the ontology middleware (Task 14.1) — co-creation and cardinality constraints are enforced.

Optional template support: if a `.sia/templates/<kind>.yaml` file exists, the node is structured according to the template fields (e.g., ADR template with context/decision/consequences/alternatives fields stored in the `properties` JSON). Templates are loaded from `.sia/templates/` at startup.

```
sia_note({
  kind: 'Decision' | 'Convention' | 'Bug' | 'Solution' | 'Concept',
  name: string,
  content: string,
  tags?: string[],
  relates_to?: string[],    // file paths or node IDs → pertains_to edges
  template?: string,        // template name from .sia/templates/
  properties?: object,      // template-specific structured fields
})
```

Acceptance criteria: `sia_note({ kind: 'Decision', name: 'Use Redis', content: '...', relates_to: ['src/cache/redis.ts'] })` creates a Tier 1 Decision node with pertains_to edge to the FileNode. Creating a Convention without relates_to throws (ontology constraint: Convention requires ≥1 pertains_to). Template with ADR fields stores structured data in properties JSON. Node appears in subsequent sia_search results.

---

**Task 14.6 — `sia_backlinks` MCP tool** — *3–4h*

Implement explicit backlinks traversal — all incoming edges to a node, grouped by edge type. This is the graph-native equivalent of Obsidian's backlink panel.

```
sia_backlinks({ node_id: string, edge_types?: string[] })
```

Returns `{ [edge_type: string]: SiaSearchResult[] }` — nodes grouped by the type of edge pointing to the target.

Acceptance criteria: FileNode for `src/auth/AuthService.ts` with 3 incoming pertains_to edges (2 Decisions, 1 Convention), 2 incoming modifies edges (EditEvents), and 4 incoming calls edges (CodeSymbols) returns all three groups correctly. Optional edge_types filter works. Empty backlinks returns empty groups.

---

**Task 14.7 — `sia_visualize` / `npx sia graph` CLI** — *8–10h*

Generate an interactive graph visualization as a local HTML file using D3.js force-directed layout. Nodes colored by kind (structural=blue, semantic=green, event=yellow, bug=red, session=gray). Edges labeled by type. Interactive filtering by kind, trust tier, time range, and community. Click a node to see its properties and backlinks. Zoom into a file and see everything connected to it.

Two output modes: `npx sia graph --open` generates HTML and opens in default browser. `npx sia graph --output graph.html` saves to file. `npx sia graph --scope src/auth/` limits to a subgraph rooted at the given path.

Acceptance criteria: Graph with 100 nodes and 200 edges renders in < 3 seconds. Filtering by kind works (show only Decisions). Clicking a node shows its properties. Scope flag limits to the relevant subgraph. Generated HTML is a single self-contained file (no external dependencies).

---

**Task 14.8 — `npx sia digest` CLI** — *4–5h*

Generate a human-readable summary of recent graph activity. Synthesizes: new decisions captured (count + top 3 summaries), conventions established, bugs identified and resolved, files most frequently modified, sessions and their intents, unresolved errors, and team contributions (if sync enabled). Output as formatted markdown to stdout or to a file.

The digest is also indexed into the graph as a ContentChunk node so the agent can reference it: "What happened this week?" → sia_search finds the weekly digest.

Acceptance criteria: `npx sia digest --period 7d` produces readable markdown covering the last 7 days. Digest includes decision summaries, convention counts, bug/solution pairs. Output indexed as ContentChunk. `npx sia digest --period 30d --output digest.md` saves to file.

---

**Task 14.9 — Markdown export/import** — *5–7h*

Export the graph as a set of interlinked markdown files, one per semantic node, with YAML frontmatter metadata (trust tier, timestamps, tags, kind) and wikilinks connecting related nodes. The result is an Obsidian-compatible vault that a developer can open, browse, and search independently of Sia.

Export structure: `sia-export/decisions/`, `sia-export/conventions/`, `sia-export/bugs/`, `sia-export/concepts/`, `sia-export/code/` (CodeSymbol summaries), `sia-export/index.md` (graph overview with links to all nodes).

Import: `npx sia import --format markdown <directory>` reads the exported vault, parses frontmatter for metadata, resolves wikilinks to graph edges, and runs through the standard consolidation pipeline (ADD/UPDATE/INVALIDATE/NOOP). Changes made in the markdown vault are merged back into the graph.

Acceptance criteria: Export a graph with 50 Decision nodes → 50 markdown files in `decisions/` with correct frontmatter and wikilinks to related nodes. Import the exported vault on a clean graph → all 50 nodes restored with correct edges. Round-trip: export → edit a decision's content in markdown → import → graph reflects the edit. Obsidian opens the exported vault with working wikilinks between notes.

---

**Task 14.10 — Documentation freshness tracking** — *3–4h*

Implement `src/knowledge/freshness.ts` — compare git modification timestamps between documentation files and the code they describe. When a DocumentNode's last git modification significantly predates changes to the CodeSymbol or FileNode nodes it references (configurable threshold, default 90 days), mark it `potentially-stale` and surface this in search results.

Integrate with the maintenance decay scheduler: stale documentation nodes receive a freshness penalty on their importance score (configurable, default -0.15), causing them to rank lower in search results without being hidden entirely. The agent behavioral layer (CLAUDE.md) is updated to qualify stale documentation: "This documentation may be outdated — last updated [date], but the code it describes was modified [date]."

Acceptance criteria: DocumentNode for ARCHITECTURE.md (modified 6 months ago) referencing CodeSymbol AuthService (modified last week) is tagged potentially-stale. Stale nodes rank lower in search results (verified: same content, one stale and one fresh, fresh ranks higher). Freshness penalty configurable. Nightly job processes all DocumentNodes.

---

## Summary Table

| Phase | Focus | Hours | Critical Path |
|---|---|---|---|
| 1 | Unified Graph Storage + SiaDb + CLAUDE.md | 52–68h | Yes |
| 2 | Local ONNX Embedder | 8–10h | Yes |
| 3 | MCP Server (14 tools) | 24–30h | Yes |
| 4 | Capture Pipeline + Session Continuity | 38–48h | Yes |
| 5 | Sandbox Execution Engine | 12–16h | Yes |
| 6 | Workspace & Multi-Repo | 18–24h | Parallel after 5 |
| 7 | AST Backbone | 14–18h | Parallel after 5 |
| 8 | Full Hybrid Retrieval | 16–20h | Parallel after 3; Task 8.5 after 6.5 |
| 9 | Community Detection & RAPTOR | 16–20h | Parallel after 5 |
| 10 | Security Layer | 14–18h | Parallel after 5 |
| 11 | Team Sync | 25–32h | Parallel after 5 |
| 12 | Decay, Lifecycle, Flagging | 16–20h | Parallel after 5 |
| 13 | Robustness, Export, Docs | 12–16h | After all phases |
| 14 | Knowledge Authoring, Ontology & Doc Ingestion | 52–68h | Parallel after 5 |
| **Total** | | **332–428h** | |

**Critical path (Phases 1–5):** 134–172 hours.

**Recommended three-developer split after Phase 5:**
- Developer A: Phases 6, 7, 10, 11 — workspace, AST, security, sync
- Developer B: Phases 8, 9, 12, 13 — retrieval, community, lifecycle, polish
- Developer C: Phase 14 — ontology, knowledge authoring, doc ingestion, visualization
