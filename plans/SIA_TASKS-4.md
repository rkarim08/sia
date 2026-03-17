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

## Phase 15 — Five-Layer Graph Freshness Engine + Native Performance Module
**Goal:** Guarantee that every fact in the knowledge graph reflects the current codebase. Implement the five-layer freshness architecture (file-watcher invalidation → git-commit reconciliation → stale-while-revalidate reads → confidence decay → periodic deep validation) with surgical, provenance-tracked invalidation that never scans the full graph. Accelerate the two highest-cost hot paths (AST diffing, graph algorithms) with an optional Rust native module via NAPI-RS, and run Leiden community detection through a long-running Python worker. All native code is optional — Sia degrades gracefully to TypeScript-only execution with ~2× slower AST diffing and a placeholder community algorithm.
**Estimated effort:** 62–80 hours
**Dependency:** Requires all Phases 1–14 complete. This is the hardening phase that makes the graph trustworthy at scale.
**Full specification:** See `SIA_PHASE15_IMPLEMENTATION.md` for complete task details, inverted dependency index schema, Salsa-inspired incremental validation, Rust NAPI-RS module design, Python worker architecture, and SQLite optimization pragmas.

---

**Task 15.1 — Inverted dependency index (source → graph nodes)** [BLOCKING] — *5–6h*

Implement the `source_deps` table that maps every source file to every graph node derived from it. When file X changes, a single indexed lookup returns the exact set of nodes that may be stale — no graph scan required. The table is maintained by triggers on `graph_nodes` INSERT/UPDATE/DELETE, using the `file_paths` JSON array and `pertains_to`/`defines`/`modifies` edges as the source mapping. For AST-extracted nodes (CodeSymbol, FileNode), the mapping is 1:1 with the source file. For LLM-inferred nodes (Decision, Convention), the mapping is derived from their `pertains_to` edges to FileNode/CodeSymbol nodes.

Include a Cuckoo filter (in-memory, rebuilt at startup from `source_deps`) for O(1) pre-screening: "does this file have ANY derived nodes?" — skips files with zero dependencies entirely (common for config files, assets, etc.). The filter supports deletion (unlike Bloom filters), which is important when dependencies change.

Acceptance criteria: Changing `src/auth/service.ts` returns exactly the 12 CodeSymbol nodes and 3 Decision nodes derived from that file, in < 0.5ms via the index. Cuckoo filter correctly pre-screens files with no derived nodes (zero false negatives). Filter rebuilt in < 100ms for 50K source-node mappings. Storage overhead: < 20% of graph.db size.

---

**Task 15.2 — Layer 1: File-watcher-driven invalidation** [BLOCKING] — *6–8h*

Implement real-time invalidation triggered by file system events. Pipeline: Bun's built-in `FileSystemWatcher` detects file save → debounce 50ms (coalesce rapid saves) → Tree-sitter incremental re-parse using `TSParser.parse(old_tree, input)` → `TSTree.getChangedRanges(old_tree, new_tree)` identifies exactly which AST regions changed → map changed ranges to specific CodeSymbol nodes via the inverted dependency index → for each affected node: if the AST node was deleted, call `invalidateNode()`; if modified, re-extract and run through two-phase consolidation (ADD/UPDATE/INVALIDATE/NOOP); if a new symbol appeared, run the standard capture pipeline for just that symbol.

This handles the >90% case: code edits during active development. The entire pipeline must complete in < 200ms per file save to avoid perceptible lag.

Acceptance criteria: Rename a function in `AuthService.ts` → the CodeSymbol node for the old name is invalidated (t_valid_until set) and a new CodeSymbol node is created, within 200ms of save. Delete a function → CodeSymbol invalidated, all edges pointing to it marked. Add a new function → new CodeSymbol created with correct `defines` edge from FileNode. No full graph scan occurs — only nodes in the inverted index for the changed file are touched. Watcher correctly ignores `node_modules/`, `.git/`, `dist/`.

---

**Task 15.3 — Layer 2: Git-commit reconciliation** — *5–6h*

Implement commit-level invalidation for changes made outside the file watcher's scope (e.g., `git merge`, `git rebase`, `git checkout`, `git stash pop`). Pipeline: PostToolUse hook detects git operations → parse the diff (`git diff HEAD~1 --stat` for commit, `git diff` for checkout/merge) → identify all changed files and line ranges → for each changed file, combine diff line ranges with AST structure to map changes to specific functions/classes/methods (use git hunk headers which already contain enclosing function names) → look up affected graph nodes via inverted dependency index → propagate invalidation along dependency edges using bounded-depth BFS (max 3 hops) with firewall nodes at high-fan-out boundaries (nodes with > 50 incoming edges).

Firewall nodes prevent cascading invalidation: if `utils/helpers.ts` is imported by 200 files, changing it does NOT invalidate all 200 files' nodes. Instead, the firewall marks the `helpers.ts` CodeSymbol nodes as dirty, and downstream nodes are validated lazily on next access (Layer 3).

Acceptance criteria: `git merge feature-branch` that modifies 5 files → exactly those 5 files' derived nodes are re-validated within 2 seconds. `git checkout` switching branches → all changed files' nodes re-validated. BFS propagation stops at firewall nodes (verified: changing a utility imported by 100 files does NOT trigger 100 file re-validations). No full graph scan.

---

**Task 15.4 — Layer 3: Stale-while-revalidate reads** [BLOCKING] — *6–8h*

Implement per-query freshness validation using a three-state model: **Fresh** (source file unmodified since extraction — serve immediately), **Stale** (source modified, within bounded window — serve immediately + trigger async background re-validation), **Rotten** (source modified, beyond staleness window — block until fresh data available).

The freshness check is a single `stat()` syscall per source file (~0.1ms on SSD) comparing `file.mtimeMs` against the node's `t_created` timestamp. For nodes with multiple source files (a Decision pertaining to 3 files), check the most-recently-modified source only — if it hasn't changed, none have (optimistic fast path).

Staleness windows are configurable and context-dependent: **30 seconds** for files the agent is actively editing (detected via EditEvent recency), **5 minutes** for files committed in the current session, **infinite** for unchanged files (event-driven invalidation via Layers 1–2 handles these).

When a stale node is read, apply **read-repair**: re-extract the relevant facts from the source file inline and update the graph before returning. This adds 10–100ms latency to the first stale read but ensures subsequent reads are fresh. The read-repair result is cached for the staleness window.

Acceptance criteria: Query a fresh node → served in < 1ms, no `stat()` call (cached mtime). Query a node whose source was modified 10 seconds ago → served immediately (stale-while-revalidate), background re-extraction starts. Query a node whose source was modified 2 minutes ago and staleness window is 30s → blocks for re-extraction (10–100ms), then serves fresh. Read-repair updates the graph atomically. Performance: < 0.2ms overhead per fresh-node query, < 1ms per stale-check.

---

**Task 15.5 — Layer 4: Confidence decay for non-deterministic facts** — *4–5h*

Implement trust-tier-specific decay with re-observation reinforcement. AST-derived facts (trust_tier 2) use **event-driven invalidation only** — no time-based decay. Their confidence stays at 1.0 until the source changes, then drops to 0 until re-verified. Time-based decay would cause unnecessary re-verification of facts about unchanged files.

LLM-inferred facts (trust_tier 3) use **exponential decay**: `confidence(t) = base_confidence × e^(-λ × decay_multiplier × Δt)` where `λ` is the decay rate constant, `decay_multiplier` adjusts by trust tier (Tier 3 high-confidence: 1.0×, Tier 3 low-confidence: 2.0×, Tier 4: 3.0×), and `Δt` is days since last access or re-observation.

Re-observation through re-extraction resets confidence using **Bayesian updating**: represent each LLM-inferred node's confidence as `Beta(α, β)` where `α` = successful re-observations, `β` = contradictions. Each re-observation increments `α`. Mean confidence = `α / (α + β)`. Store `α` and `β` in the node's `properties` JSON. This means a Decision that is re-confirmed across 5 sessions converges toward certainty, while a Decision observed only once decays on schedule.

User-stated facts (trust_tier 1) decay very slowly (half-life 30 days) because developer preferences and conventions are long-lived but not permanent.

Acceptance criteria: AST-derived CodeSymbol unchanged for 90 days → confidence still 1.0 (no decay applied). LLM-inferred Decision not accessed for 7 days → confidence drops ~50% (1-week half-life). Same Decision re-observed in a new session → α incremented, confidence resets toward base. Tier 4 external fact decays 3× faster than Tier 3. User-stated Convention decays with 30-day half-life.

---

**Task 15.6 — Layer 5: Periodic deep validation** — *5–6h*

Implement the maintenance validation sweep (startup catchup + idle opportunistic) that catches anything the real-time layers missed. Four sub-tasks run sequentially:

(a) **Documentation-vs-code cross-validation**: For each DocumentNode with `references` edges to CodeSymbol/FileNode nodes, compare the document's content hash against the referenced code's current hash. If the code has changed materially since the document was last ingested, tag the DocumentNode `potentially-stale` and apply the freshness penalty. Integrates with Task 14.10's freshness tracking.

(b) **LLM claim re-verification**: Sample up to 20 LLM-inferred nodes with the lowest current confidence (near the archival threshold). For each, check whether the claim still holds against current code. If contradicted, invalidate. If confirmed, re-observe (increment α). This is a Haiku API call per node, so it runs during idle processing at a rate of 1 call per 5 seconds.

(c) **Personalized PageRank recomputation**: Reload the graph's active edge set into memory, compute PersonalizedPageRank biased toward recently-accessed files, update `importance` scores on all nodes. Use the Rust graph module (Task 15.9) if available, otherwise fall back to TypeScript.

(d) **Version compaction**: Archive fact versions where `t_expired < now - retention_window` (default 90 days). Hard-delete archived event nodes older than 30 days with `importance < archiveThreshold` and `edge_count = 0`. Compact the FTS5 index via `INSERT INTO graph_nodes_fts(graph_nodes_fts) VALUES('optimize')`.

Acceptance criteria: Nightly job completes in < 60 seconds for a 50K-node graph. Stale documentation detected and tagged. LLM claims re-verified (at least 20 per run). PageRank updated. Compaction reduces historical storage by > 20% per month for actively-developed projects. Job does not block the MCP server (runs in a separate connection).

---

**Task 15.7 — Dirty propagation engine (Adapton-inspired)** — *6–8h*

Implement two-phase dirty propagation for efficient invalidation through dependency chains, inspired by the Salsa/Adapton incremental computation frameworks.

**Phase 1 (Push — active):** When a source file changes (via Layer 1 or 2), immediately traverse the inverted dependency index and mark all derived nodes as `dirty` (a lightweight in-memory flag, not a database write). Then traverse outgoing dependency edges from dirty nodes and mark their targets as `dirty` too, up to a configurable depth (default 2 hops). Firewall nodes (edge_count > 50) stop propagation — their dependents are marked `maybe_dirty` instead.

**Phase 2 (Pull — lazy):** When a query accesses a `dirty` node, re-verify it against its sources. If the node's content is unchanged (e.g., whitespace-only edit to source file), clear the dirty flag WITHOUT propagating to dependents — this is the **early cutoff** optimization from Salsa that prevents cascading re-verification for cosmetic changes. If the content changed, update the node and propagate dirty flags to its dependents.

**Durability tiers** (from Salsa): Mark standard-library and third-party dependency facts as `durable` — they skip dirty checking entirely when only volatile (user code) inputs change. This eliminates ~30% of validation work for typical projects.

Acceptance criteria: Change a file → dirty propagation completes in < 1ms for a 10K-node graph. Access a dirty node → re-verification runs inline. Early cutoff: whitespace-only edit propagates dirty to 0 dependents (verified: add a comment to a function, dependent Decision nodes are NOT re-verified). Durability: changing user code does NOT dirty-check facts about `node_modules` imports. Firewall: changing a widely-imported utility marks immediate dependents dirty but does NOT cascade to all transitive dependents.

---

**Task 15.8 — SQLite performance hardening** — *3–4h*

Apply the full set of SQLite optimizations that support sub-millisecond freshness checks on the bi-temporal graph.

(a) **Optimal PRAGMA configuration**: `journal_mode=WAL`, `synchronous=NORMAL`, `mmap_size=1073741824` (1GB virtual, demand-paged — eliminates one memory copy per page read for 33% faster reads), `temp_store=MEMORY`, `cache_size=-64000` (64MB), `page_size=4096`.

(b) **Partial index audit**: Verify that every query in the retrieval pipeline uses a partial index with `WHERE t_valid_until IS NULL AND archived_at IS NULL`. Add any missing partial indexes identified by `EXPLAIN QUERY PLAN`.

(c) **Current-state shadow table**: Create a `current_nodes` table maintained by triggers that contains only active, non-archived nodes. This eliminates the temporal predicate from the most common query pattern (current-state lookup), reducing index traversal depth by ~10× for graphs where 90% of rows are historical.

(d) **FTS5 optimization scheduling**: After each maintenance deep validation sweep, execute `INSERT INTO graph_nodes_fts(graph_nodes_fts) VALUES('optimize')` to merge FTS5 segments. Configure `automerge=4` for aggressive background merging.

(e) **Prepared statement caching**: Ensure all hot-path queries use `db.prepare()` with cached statements rather than per-query compilation. Bun's `bun:sqlite` supports this natively.

Acceptance criteria: Single node lookup by ID: < 0.05ms (50μs). 2-hop BFS traversal: < 5ms. Bi-temporal range query: < 3ms. FTS5 keyword search: < 10ms. Concurrent read + write (MCP server query during capture pipeline write): zero SQLITE_BUSY errors under WAL. `mmap_size` set to 1GB without increasing physical memory usage beyond actual database size. All hot-path queries confirmed using partial indexes via `EXPLAIN QUERY PLAN`.

---

**Task 15.9 — Rust native performance module (@sia/native)** — *10–14h*

Implement an optional Rust module via NAPI-RS exposing three batch-oriented APIs for the highest-cost hot paths. The module is distributed as prebuilt platform-specific npm packages via `optionalDependencies` (darwin-arm64, darwin-x64, linux-x64-gnu, linux-x64-musl, linux-arm64-gnu, win32-x64-msvc). A Wasm fallback (`@sia/native-wasm`) provides universal coverage at ~2× slower execution. If neither native nor Wasm is available, Sia falls back to pure TypeScript implementations with no functionality loss.

**API 1 — AST Diffing (`astDiff`)**: Accepts two Tree-sitter parse trees (serialized as byte arrays) and returns a structured edit script with insert, remove, update, and move operations mapped to graph node IDs. Uses a GumTree-style matching algorithm (O(n²) in the worst case, typically O(n log n) for similar trees). The Rust implementation provides 5–20× speedup over JavaScript for the matching phase. Exposed as a synchronous NAPI function — the computation is CPU-bound and typically completes in 1–50ms, making async overhead counterproductive.

**API 2 — Graph Algorithm Suite (`graphCompute`)**: Accepts the graph's edge list (as a flat `Int32Array` of `[from, to, weight]` triples) and a command enum specifying the algorithm. Supported algorithms: PersonalizedPageRank (biased toward a seed set), shortest-path (Dijkstra from a source node to all reachable nodes), betweenness centrality, and connected components. Results are returned as a `Float64Array` of scores indexed by node position. The Rust module caches the graph structure in `petgraph`'s compact adjacency list format (~6–8MB for 50K nodes / 200K edges) across multiple `graphCompute` calls within the same session, amortizing the data transfer cost.

**API 3 — Leiden Community Detection (`leidenCommunities`)**: Uses the `graphrs` crate (v0.11.15, MIT license, pure Rust) to run Leiden at multiple resolution parameters. Reuses the cached petgraph structure from `graphCompute` when available (zero additional data transfer). Returns community membership arrays for each resolution level. This eliminates the need for a Python subprocess entirely — community detection runs in-process via NAPI-RS with zero process overhead.

**Build and distribution**: NAPI-RS v3 with `@napi-rs/cli` for cross-compilation. CI matrix builds 6 targets in parallel GitHub Actions. Total binary size per platform: ~3–6MB. Installation via `optionalDependencies` adds < 5 seconds to `npm install`. No Rust toolchain required on the user's machine — prebuilt binaries only.

**Graceful degradation**: `src/native/bridge.ts` detects whether the native module loaded. If not, falls back to `src/native/fallback-ast-diff.ts` (JavaScript GumTree port, ~5× slower), `src/native/fallback-graph.ts` (JavaScript PageRank/Dijkstra on `Map<string, Array>`, ~3× slower), and `graphology-communities-louvain` for community detection. All callers import from `bridge.ts` and never reference the native module directly.

Acceptance criteria: `astDiff` on two 500-node parse trees completes in < 10ms (Rust) vs < 100ms (JS fallback). `graphCompute(PageRank)` on 50K nodes / 200K edges completes in < 20ms (Rust) vs < 80ms (JS). `leidenCommunities` on 50K nodes at 3 resolution levels completes in < 500ms (Rust) vs < 1s (JS Louvain fallback). Module loads successfully in Bun on macOS ARM, macOS Intel, Linux x64. Wasm fallback loads when native unavailable. TypeScript fallback loads when both native and Wasm unavailable. All three paths produce identical results for astDiff and graphCompute (verified by comparison test suite). `npx sia install` completes in < 3 minutes with or without the native module.

---

**Task 15.10 — Community detection bridge (Louvain primary + Rust Leiden)** — *4–5h*

Implement `src/community/detection-bridge.ts` — a community detection pipeline with two tiers: JavaScript Louvain as the zero-overhead primary, and Rust Leiden (via `graphrs` crate in `@sia/native`) as the high-quality path when the native module is available. No Python dependency. No subprocess. No IPC. Everything runs in-process.

**Primary path — JavaScript Louvain (`graphology-communities-louvain`)**: Runs in-process with zero process overhead. Handles 50K nodes in < 1 second. Includes a connected-components post-processing step that splits any disconnected communities Louvain produces (addresses Louvain's known disconnection issue — affects ~1% of communities in a single pass, negligible for code graphs). Modularity difference versus Leiden is ~0.2%, functionally unmeasurable for code knowledge graphs where module boundaries are structurally clear.

**Native path — Rust Leiden (via `@sia/native`)**: Add a third API to the `@sia/native` NAPI-RS module (Task 15.9) using the `graphrs` crate (v0.11.15, MIT license, pure Rust, no C/C++ dependencies). Accepts the same edge list format as `graphCompute`, runs Leiden at three resolution parameters (2.0, 1.0, 0.5 for hierarchical community levels), returns community membership arrays. Integrates into the existing cached `petgraph` structure, so the graph data transfer is amortized if `graphCompute` has already loaded the graph. When `@sia/native` is available, the bridge automatically uses Rust Leiden instead of JS Louvain — transparent upgrade with no API change.

The bridge exposes a single `detectCommunities()` function that checks `isNativeAvailable()` and routes accordingly. All callers are unaware of which implementation runs underneath.

Acceptance criteria: JS Louvain on 50K nodes / 200K edges completes in < 1 second with correct community assignments. Connected-components post-processing splits disconnected communities (verified: inject a test graph with a known disconnected Louvain result → post-processing splits it). Rust Leiden (when native module available) produces communities at all 3 resolution levels in < 500ms for 50K nodes. Bridge correctly falls back to Louvain when native module unavailable. `npx sia doctor` reports which community detection backend is active. No Python required. No separate process spawned.

---

**Task 15.11 — Freshness-aware agent behavioral updates** — *3–4h*

Update CLAUDE.md base module and playbooks to leverage the freshness engine.

(a) **Step 2 safety layer gains freshness qualification**: When `sia_search` returns results, each result now carries a `freshness` field (`fresh`, `stale`, `rotten`). The agent qualifies stale results: "This fact may not reflect the latest code — it was extracted from [file] which was modified [time ago]. Let me verify." For rotten results (should be rare — blocked by Layer 3), the agent re-queries after the blocking re-validation completes.

(b) **Invariant 9 (new)**: "Never state an LLM-inferred fact (trust_tier 3) as definitive if its confidence has decayed below 0.5. Always qualify with 'Sia's memory suggests X — confidence has decreased since last verification, let me check the current code.'"

(c) **Sandbox routing for verification**: When the agent needs to verify a stale fact, it uses `sia_execute` to read the relevant source file through the sandbox rather than raw `cat`, keeping the verification content out of context.

(d) **sia-tools.md** updated with `freshness` field documentation on `SiaSearchResult`, freshness states, and guidance on when to trust vs verify results.

Acceptance criteria: Agent receives a stale Decision → qualifies it before acting. Agent receives a rotten ErrorEvent → waits for re-validation, then proceeds. Agent never states a decayed Tier 3 fact (confidence < 0.5) as definitive. Verification uses sandbox tools.

---

**Task 15.12 — `npx sia freshness` CLI and `sia_stats` freshness metrics** — *3–4h*

Add a `freshness` subcommand to the CLI that reports the graph's overall freshness state: total nodes, fresh nodes, stale nodes, rotten nodes, nodes pending re-validation, average confidence by trust tier, last deep validation timestamp, inverted index coverage (percentage of nodes with source mappings), and the Cuckoo filter's false positive rate.

Update `sia_stats` MCP tool output to include freshness metrics: `{ fresh_percent, stale_count, rotten_count, avg_confidence_by_tier, last_deep_validation, native_module_loaded }`.

Acceptance criteria: `npx sia freshness` produces readable output on a test graph. `sia_stats` includes freshness metrics. Output distinguishes AST-derived (event-driven) from LLM-inferred (decay-based) freshness models.

---

## Phase 16 — Hooks-First Knowledge Capture + Pluggable LLM Fallback
**Goal:** Redesign Sia's knowledge extraction to use Claude Code's hook system as the primary capture mechanism — capturing knowledge in real-time at zero additional LLM cost during active sessions — with the Vercel AI SDK pluggable provider layer as a fallback for offline operations and non-Claude-Code agents. This three-layer architecture means: (1) hooks capture every tool operation with full I/O as Claude works, (2) CLAUDE.md instructions make Claude proactively call Sia tools when it makes decisions, and (3) the pluggable LLM provider handles community summarization, deep validation, and any extraction that hooks can't reach. The result is dramatically cheaper operation (~$0 for real-time extraction vs ~$0.36/day under the pure API approach) with richer knowledge capture because hooks observe at the moment of maximum context.
**Estimated effort:** 42–54 hours
**Dependency:** Requires Phase 4 (capture pipeline) complete. Can begin in parallel with Phases 14–15.
**Full specification:** See `SIA_PHASE16_IMPLEMENTATION.md` for complete task details, hook event schemas, HTTP hook integration patterns, CLAUDE.md behavioral directives, Vercel AI SDK provider registry, Zod schemas, and cross-agent portability strategy.

---

**Task 16.1 — Hook event router and HTTP endpoint** [BLOCKING] — *6–8h*

Implement `src/hooks/event-router.ts` — an HTTP server (or stdin/stdout handler) that receives Claude Code hook events and routes them to the appropriate Sia capture pipeline. The router registers handlers for 7 critical hook events: PostToolUse (captures every tool operation with full I/O), Stop (processes session segments for missed knowledge), PreCompact (snapshots graph state before context compaction), PostCompact (identifies what survived compaction), SessionStart (injects relevant graph context), SessionEnd (finalizes the session's knowledge), and Notification (captures Claude's status messages).

The router is exposed as an HTTP endpoint at `http://localhost:<port>/hooks` for Claude Code's HTTP hook type, and also as a stdin/stdout command handler for the command hook type. Both paths parse the hook's JSON envelope (containing `session_id`, `transcript_path`, `hook_event_name`, `tool_name`, `tool_input`, `tool_response`) and dispatch to event-specific handlers.

Hook configuration is installed via `npx sia install` into `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{ "type": "http", "url": "http://localhost:4521/hooks/post-tool-use", "async": true }],
    "Stop": [{ "type": "http", "url": "http://localhost:4521/hooks/stop" }],
    "PreCompact": [{ "type": "http", "url": "http://localhost:4521/hooks/pre-compact" }],
    "PostCompact": [{ "type": "http", "url": "http://localhost:4521/hooks/post-compact" }],
    "SessionStart": [{ "type": "command", "command": "npx sia hook session-start" }],
    "SessionEnd": [{ "type": "http", "url": "http://localhost:4521/hooks/session-end", "async": true }]
  }
}
```

PostToolUse hooks run async (non-blocking — Claude continues immediately). Stop and PreCompact hooks run sync (Sia must finish processing before Claude proceeds). SessionStart uses a command hook because it must write to stdout to inject context into Claude's conversation.

Acceptance criteria: PostToolUse hook receives full `tool_name`, `tool_input`, and `tool_response` for Write, Read, Bash, Edit, and MCP tool operations. Hook fires within 50ms of tool completion. Async hooks do not block Claude Code's execution. Sync hooks complete within 2 seconds. `npx sia install` correctly configures hooks in `.claude/settings.json`.

---

**Task 16.2 — PostToolUse knowledge extractor** [BLOCKING] — *6–8h*

Implement `src/hooks/handlers/post-tool-use.ts` — the core handler that extracts knowledge from every tool operation Claude performs, at zero additional LLM cost.

The handler receives the full tool I/O and applies deterministic extraction rules based on tool type:

**Write tool**: File path + full content written → create/update FileNode, trigger Tree-sitter AST extraction for CodeSymbol nodes, detect if content matches Decision/Convention patterns (e.g., comments containing "we decided", "convention:", "TODO:", "FIXME:", "BUG:").

**Edit/MultiEdit tool**: File path + old_string + new_string → create EditEvent node with `modifies` edge to FileNode, detect renamed/moved symbols via AST diff (feeds Layer 1 of the freshness engine).

**Bash tool**: Command + exit code + output → create ExecutionEvent node. Detect test results (pass/fail patterns), build commands, git operations. For git commands, create GitEvent nodes. For failed commands (exit code ≠ 0), create ErrorEvent nodes.

**Read tool**: File path + content read → no graph mutation needed (read-only), but log as a SearchEvent for session tracking and importance boosting (files Claude reads are likely relevant).

**MCP tool calls (sia_*)**: When Claude calls Sia's own MCP tools, the PostToolUse hook sees both the query and the result. Log these as SearchEvent nodes and use the query patterns to improve retrieval quality over time.

For ambiguous cases where deterministic extraction is insufficient (e.g., Claude writes a long comment explaining an architectural decision but doesn't explicitly call `sia_note`), the handler queues the event for batch processing by the Stop hook, which has access to the full transcript for context.

Acceptance criteria: Claude writes `src/auth/service.ts` → FileNode created/updated, CodeSymbol nodes extracted via AST, EditEvent recorded with `modifies` edge. Claude runs `npm test` and tests fail → ExecutionEvent + ErrorEvent created. Claude runs `git commit -m "fix auth bug"` → GitEvent created with `references` edges to committed files. All extraction is deterministic (no LLM calls). Processing completes in < 100ms per hook event.

---

**Task 16.3 — Stop hook session processor** — *4–5h*

Implement `src/hooks/handlers/stop.ts` — fires when Claude finishes a response or a subagent completes. This handler reads the session transcript (via `transcript_path`) and processes the recent conversation segment for knowledge that the PostToolUse hook couldn't capture deterministically.

The Stop hook handles three categories: (a) decisions and reasoning expressed in Claude's natural language responses (not captured by PostToolUse because they aren't tool operations), (b) consolidation of multiple PostToolUse events into coherent knowledge units (e.g., a series of file edits that collectively implement a decision), and (c) detection of uncaptured knowledge — if Claude discussed a convention or made a decision but didn't call `sia_note`, the Stop hook catches it.

For semantic analysis of conversation text, the Stop hook uses Claude Code's built-in **prompt hook type** — a lightweight Haiku call integrated into the hook system that uses the developer's existing Claude Code API key. This is cheaper and simpler than making a separate API call through the Vercel AI SDK, and it only fires when the Stop hook detects potentially unextracted knowledge in the transcript.

Acceptance criteria: Claude discusses "let's use JWT RS256 for authentication" in conversation without calling `sia_note` → Stop hook detects the uncaptured Decision and creates a Decision node via the graph API. Stop hook processes only the transcript segment since the last Stop event (not the full history). Prompt hook fires only when ambiguous content is detected (not on every Stop event). Processing completes in < 5 seconds.

---

**Task 16.4 — PreCompact/PostCompact/SessionStart/SessionEnd handlers** — *4–5h*

Implement the four session lifecycle handlers:

**PreCompact** (`src/hooks/handlers/pre-compact.ts`): Reads `transcript_path` to process any remaining unextracted knowledge before the conversation is compacted. Snapshots the current session's graph state (active nodes, recent edges, pending dirty flags) to `.sia/session-snapshots/<session_id>.json`. This is Sia's insurance against compaction-induced knowledge loss.

**PostCompact** (`src/hooks/handlers/post-compact.ts`): Receives `compact_summary` — the text that Claude will remember after compaction. Compares this against the session snapshot to identify what was lost. Logs a diagnostic: "Compaction preserved 70% of session knowledge; 3 Decision nodes, 2 Convention nodes retained in graph."

**SessionStart** (`src/hooks/handlers/session-start.ts`): This is a **command hook** (not HTTP) because it must write to stdout to inject context. When Claude starts a new session, Sia queries the graph for relevant context (recent Decisions, active Conventions, unresolved Bugs pertaining to the working directory) and outputs a formatted context block that becomes part of Claude's initial conversation. This replaces the "Session Guide" concept from the v5 architecture with a hook-native implementation.

**SessionEnd** (`src/hooks/handlers/session-end.ts`): Finalizes the session's knowledge — updates the SessionNode's `ended_at` timestamp, computes session statistics (nodes created, edges added, tools used), and triggers any deferred consolidation.

Acceptance criteria: PreCompact snapshots session state in < 1 second. SessionStart injects relevant context (verified: Claude's first response references graph knowledge without being explicitly asked). SessionEnd correctly finalizes session metadata. Full lifecycle: SessionStart → [work] → PreCompact → PostCompact → SessionEnd produces a complete session record in the graph.

---

**Task 16.5 — CLAUDE.md behavioral directives for proactive knowledge capture** — *3–4h*

Update the CLAUDE.md base module and playbooks with directives that make Claude proactively call Sia's MCP tools when it makes decisions, discovers patterns, or encounters bugs. This is the highest-value change in Phase 16 because Claude already has full context when making decisions — no extraction LLM is needed to re-analyze what Claude understood at the time.

Add to CLAUDE.md:

```markdown
## Sia Knowledge Management
- When choosing between architectural alternatives, call mcp__sia__note with kind='Decision',
  the decision name, your reasoning, the alternatives considered, and the files affected.
- When establishing or recognizing a coding convention, call mcp__sia__note with kind='Convention'.
- When discovering a bug pattern or root cause, call mcp__sia__note with kind='Bug'.
- When resolving a bug, call mcp__sia__note with kind='Solution' and link it to the Bug.
- Before starting any coding task, call mcp__sia__search to check for relevant prior knowledge.
- After completing a significant task, call mcp__sia__note with kind='Concept' to summarize what was done.
```

These directives are **additive** to the hook-based capture — even if Claude forgets to call `sia_note`, the PostToolUse and Stop hooks catch the knowledge deterministically. The directives handle the semantic/reasoning layer (why decisions were made) while hooks handle the structural layer (what was done).

Acceptance criteria: Claude makes an architectural decision → calls `sia_note` with Decision kind, reasoning, and alternatives (verified on 8/10 decision scenarios in testing). Claude encounters a bug → calls `sia_note` with Bug kind. Claude starts a new task → calls `sia_search` first. Directives are compatible with existing CLAUDE.md content and do not interfere with other playbooks.

---

**Task 16.6 — Vercel AI SDK provider registry (for offline operations)** — *5–6h*

Implement the pluggable LLM provider layer for operations that hooks cannot handle: community summarization (requires reasoning across the full graph, not a single tool event), deep validation (Phase 15 Layer 5 maintenance sweep — no active session), batch processing (reindexing, digest generation), and non-Claude-Code agent support (Cursor, Windsurf, Cline fallback).

Built on the Vercel AI SDK with the same architecture as the original Phase 16 design: `ProviderRegistry` with role-based model assignment, Zod schemas as the single source of truth, `@ai-sdk/anthropic` + `@ai-sdk/openai` + `@ai-sdk/google` + `@ai-sdk/openai-compatible` (Ollama). The key difference: only `summarize` and `validate` roles are expected to make LLM calls regularly. The `extract` and `consolidate` roles exist as fallbacks for when hooks are unavailable (non-Claude-Code agents or CLI batch operations like `npx sia reindex`).

Configuration in `sia.config.yaml` now distinguishes between hook-mode (primary, Claude Code) and api-mode (fallback, non-Claude-Code or offline):

```yaml
capture:
  mode: hooks            # hooks | api | hybrid
  # hooks: use Claude Code hooks for real-time capture (default when Claude Code detected)
  # api: use LLM API calls for all extraction (fallback for non-Claude-Code agents)
  # hybrid: hooks for real-time + api for batch operations

providers:
  summarize:
    provider: anthropic
    model: claude-sonnet-4
  validate:
    provider: ollama
    model: qwen2.5-coder:7b
  extract:               # only used in api/hybrid mode
    provider: anthropic
    model: claude-haiku-4-5
  consolidate:            # only used in api/hybrid mode
    provider: anthropic
    model: claude-haiku-4-5
```

Acceptance criteria: In hooks mode (default), `extract` and `consolidate` providers are never called during Claude Code sessions. In api mode, all four providers are called (backward-compatible with original Phase 16 design). In hybrid mode, hooks handle real-time capture and the `extract` provider handles batch operations. `npx sia doctor` correctly reports which capture mode is active.

---

**Task 16.7 — Zod schemas and structured extraction pipeline** — *4–5h*

Implement Zod schemas for all four operation roles (extraction, consolidation, summarization, validation) and the `reliableGenerateObject()` wrapper with retry, fallback chain, circuit breaker, and `json-repair`. This is the same content as the original Phase 16 Tasks 16.2, 16.3, and 16.7, consolidated into a single task because the scope is reduced — only the `summarize` and `validate` paths are regularly active.

The schemas, fallback chain, circuit breaker, and error recovery logic are identical to the original Phase 16 design. The key change: the `extract` and `consolidate` schemas now also serve as the format for hook-captured knowledge (PostToolUse handlers produce `SiaExtractionResult`-shaped objects that flow through the same consolidation pipeline).

Acceptance criteria: `generateObject()` with `SiaSummaryResult` schema produces valid community summaries from Anthropic, OpenAI, and Ollama. `generateObject()` with `SiaValidationResult` produces valid validation results. Fallback chain works: primary provider down → next in chain. Circuit breaker opens after >50% failures. `json-repair` fixes ~30% of malformed responses without retrying.

---

**Task 16.8 — Configuration, cost tracking, and doctor diagnostics** — *4–5h*

Implement `sia.config.yaml` with the three-tier hierarchy (env vars → config file → CLI flags), per-call cost tracking to `.sia/cost-log.jsonl`, daily budget enforcement, and `npx sia doctor --providers` diagnostics. The config format now includes the `capture.mode` field (hooks | api | hybrid) alongside the role-based provider assignments.

`npx sia doctor` reports both hook health and provider health:

```
$ npx sia doctor
Capture Mode: hooks (Claude Code detected)

Hook Configuration:
  ✓ PostToolUse: HTTP async → localhost:4521 (connected)
  ✓ Stop: HTTP sync → localhost:4521 (connected)
  ✓ PreCompact: HTTP sync → localhost:4521 (connected)
  ✓ SessionStart: command → npx sia hook session-start (executable)
  ✓ SessionEnd: HTTP async → localhost:4521 (connected)

LLM Providers (offline operations):
  summarize:   anthropic / claude-sonnet-4     ✓ connected (312ms)
  validate:    ollama / qwen2.5-coder:7b       ✓ connected (8ms)
  extract:     anthropic / claude-haiku-4-5    ⚡ standby (hooks active)
  consolidate: anthropic / claude-haiku-4-5    ⚡ standby (hooks active)

Estimated Daily Cost: ~$0.04/day (hooks mode)
  Real-time extraction: $0.00 (hooks — zero LLM cost)
  summarize (1 call × $0.018): $0.02
  validate (5 calls × $0.00): $0.00 (local)
  Stop hook prompt calls (~5 × $0.001): $0.005
```

Acceptance criteria: `sia doctor` correctly detects Claude Code presence and hook connectivity. Cost tracking logs every LLM call. Budget warning at 80%, hard stop at 120%. Doctor reports both hook health and provider health in a single view.

---

**Task 16.9 — Cross-agent portability adapter** — *3–4h*

Implement `src/hooks/adapters/` — thin adapter layers that normalize hook events from non-Claude-Code agents into Sia's common event format. This ensures Sia works beyond Claude Code.

**Cursor adapter** (`cursor-adapter.ts`): Cursor provides hooks via `.cursor/hooks/` with events `beforeSubmitPrompt`, `afterFileEdit`, `afterModelResponse`. Map `afterFileEdit` → PostToolUse(Write), `afterModelResponse` → Stop, `beforeSubmitPrompt` → UserPromptSubmit.

**Cline adapter** (`cline-adapter.ts`): Cline provides `PreToolUse`, `PostToolUse`, `UserPromptSubmit` hooks with JSON stdin/stdout — almost identical to Claude Code's command hook format. Thin mapping layer required.

**Generic MCP-only fallback** (`generic-adapter.ts`): For agents with no hook system (Windsurf, Aider), Sia falls back to the `api` capture mode — all extraction runs through the Vercel AI SDK provider registry. MCP tools still work for retrieval.

Auto-detection: `npx sia install` detects the active agent (Claude Code via `.claude/` directory, Cursor via `.cursor/` directory, Cline via `.clinerules/`) and installs the appropriate hook configuration.

Acceptance criteria: Sia works with Cursor hooks (afterFileEdit → FileNode created). Sia works with Cline hooks (PostToolUse → same pipeline as Claude Code). Sia works with Windsurf (api mode fallback, MCP tools for retrieval). `npx sia install` correctly detects and configures for the active agent.

---

**Task 16.10 — Cross-provider prompt optimization** — *3–4h*

Create a prompt template system (`src/llm/prompts/`) for the operations that still require LLM calls (summarization, validation, and api-mode extraction/consolidation). Universal base prompts use XML-delimited sections (works well across Claude, GPT, and Gemini). Provider-specific hint layers optimize for each model's strengths. Context window adaptation handles the range from Gemini's 1M tokens to Ollama's 4K–32K.

Acceptance criteria: Same code context fed to Anthropic, OpenAI, and Ollama produces structurally valid extraction results from all three. Provider-specific hints improve quality measurably (≥ 5% more entities on benchmark). Prompt templates are < 2000 tokens for the base.

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
| 15 | Five-Layer Freshness Engine + Native Performance | 62–80h | After all phases |
| 16 | Hooks-First Knowledge Capture + LLM Fallback | 42–54h | Parallel after 4 |
| **Total** | | **436–562h** | |

**Critical path (Phases 1–5):** 134–172 hours.

**Recommended three-developer split after Phase 5:**
- Developer A: Phases 6, 7, 10, 11 — workspace, AST, security, sync
- Developer B: Phases 8, 9, 12, 13 — retrieval, community, lifecycle, polish
- Developer C: Phase 14, 16, then 15 — ontology, knowledge authoring, hooks + LLM layer, freshness engine, native module
