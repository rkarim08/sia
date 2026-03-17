# Product Requirements Document
## Sia — Persistent Graph Memory for AI Coding Agents

> *Sia was the Egyptian personification of perception, insight, and divine knowledge. She rode on the prow of Ra's solar barque and was said to write knowledge on the heart — the precise act of embedding structured understanding into a store that shapes all future reasoning.*

**Version:** 4.0  
**Status:** Draft  
**Last Updated:** 2026-03-14  
**Note:** ARCHI v4.1 (same date) added additive MCP interface changes (`conflict_group_id`, `t_valid_from`, `invalidated_entities`, `include_provenance?`). These are implementation surface changes; product-level semantics are unchanged.  
**Changelog from v3:** Fixes issues #1–#33 identified in adversarial review. Key changes: bi-temporal model now applies to entities as well as edges; language support redesigned as an extensible registry covering all major languages; `--paranoid` mode fully specified; Turborepo detection corrected; Sia Cloud moved to §10 Future Directions; entity type 'Architecture' removed in favour of Concept with tags; trust multipliers corrected and justified.

---

## 1. Executive Summary

Sia is a persistent, graph-structured memory system for Claude Code and other MCP-compatible AI coding agents. It solves the most fundamental limitation of long-running AI-assisted development: **the agent forgets everything the moment a session ends.**

Every context switch, every overnight break, every new terminal resets Claude Code to zero. Decisions made Monday about the authentication architecture are invisible on Friday. Bugs carefully analyzed last week are rediscovered from scratch. Conventions that took days to establish must be re-explained. Across a month of daily development this represents hours of compounding lost effort — and across a team, the problem multiplies further because each developer's agent independently rebuilds the same understanding of the same codebase in isolation.

Existing solutions inject a flat text dump into `CLAUDE.md` at the start of every session. This collapses at scale: the file grows without bound, every session pays the full context cost regardless of relevance, relationships between memories cannot be expressed, stale facts about deprecated code compete equally with current architecture decisions, and knowledge is siloed per-developer with no mechanism for sharing.

Sia replaces this model with six architectural commitments:

**Tri-tiered memory hierarchy.** Working memory (current session buffer), semantic memory (persistent knowledge graph), and episodic memory (non-lossy interaction archive) operate as distinct tiers with explicit promotion pipelines between them.

**Bi-temporal knowledge graph.** Every fact — both entities and the edges connecting them — carries four timestamps: when recorded in Sia, when Sia marked it superseded, when it became true in the world, and when it stopped being true. Facts are never deleted; they are invalidated and superseded. Stale facts never pollute current reasoning.

**AST-powered structural backbone with extensible language support.** Tree-sitter parses the codebase deterministically using a declarative, runtime-extensible language registry covering TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Swift, C#, C, C++, PHP, Ruby, SQL, and many more. This structural scaffold is free, instant, always current, and anchors all LLM-inferred knowledge.

**Dual-track extraction with two-phase consolidation.** A deterministic NLP/AST track and a probabilistic LLM track both feed a two-phase pipeline that merges near-duplicates, detects contradictions, and applies four operations (ADD, UPDATE, INVALIDATE, NOOP) rather than blindly appending.

**Multi-repository workspace model.** Unrelated projects are completely isolated. Related repositories are linked in a workspace with explicit cross-repo edges. Monorepos are auto-detected from their package manager configuration and scoped at the package level.

**Local-first with optional team sync.** By default everything stays on the developer's machine — no network dependency, no server required. When team sharing is enabled, a lightweight self-hosted sync server (a single Docker container) gives every team member access to shared knowledge, with a three-tier visibility model: private, team, and project-scoped.

---

## 2. Problem Statement

### 2.1 Core Pain Points

**Session amnesia.** Claude Code has no persistent memory between sessions. A developer spends 45 minutes explaining the project's architecture, the team's coding conventions, and the reasons behind a complex database schema — none of it survives the session boundary. The next session starts from zero. Over a month of daily development, this represents hours of re-explanation.

**Flat memory injection breaks at scale.** Solutions that inject a `CLAUDE.md` file provide temporary relief but create a new problem: as the project matures, injected context grows to thousands of tokens per session, most irrelevant to any given task.

**No relationship structure.** Flat memory cannot express that "this bug was caused by that anti-pattern," that "this solution supersedes that earlier decision," or that "changing this function will cascade to these three modules." Knowledge about a codebase is fundamentally relational.

**No temporal awareness.** A fact from six months ago — "we use React 17" — becomes wrong when the project upgrades to React 19, but a flat memory system has no mechanism to invalidate it. The agent confidently reasons from false premises.

**Multi-repo and multi-language projects are unmanageable.** A fullstack developer works in a TypeScript frontend repo and a C# backend repo that call each other's APIs. No existing local memory tool represents these cross-repo, cross-language relationships.

**Team knowledge is siloed per-developer.** Each developer's AI agent independently rebuilds the same understanding of the same codebase. Architectural decisions made in one developer's sessions are invisible to another's.

**Memory poisoning is an ignored attack surface.** Naive memory write paths achieve over 95% injection success rates when agents read malicious content. A developer whose agent reads a poisoned README could have false "conventions" written into their persistent memory store.

### 2.2 Who This Is For

**Primary user (solo developer):** Uses Claude Code for active, multi-session development on one or more projects. Sia becomes valuable from the second session. The multi-repo workspace model is immediately useful for any developer working across a frontend and backend simultaneously.

**Secondary user (small team, 2–10 developers):** Wants shared institutional memory — architectural decisions, discovered patterns, bug histories, team conventions — that any team member's AI agent can access with minimal infrastructure overhead.

**Tertiary user (larger team, 10–20+ developers):** Needs reliable team knowledge sharing across many developers and repositories, with per-project scoping, visibility controls, and conflict resolution for concurrent contributions.

---

## 3. Goals and Non-Goals

### 3.1 Goals

Sia captures knowledge from Claude Code sessions automatically with no required developer input beyond initial installation.

Sia maintains a typed, weighted, bi-temporal knowledge graph where **both entities and edges** carry full temporal metadata: when recorded, when it became true in the world, and when it stopped being true.

Sia exposes MCP tools that Claude Code calls on demand to retrieve only the context relevant to the current task.

Sia supports a declarative, extensible language registry. Out of the box it covers all widely-used programming languages. Users can register additional Tree-sitter grammars at runtime via configuration without modifying source code.

Sia manages multiple repositories through a workspace model: isolated graphs for unrelated projects, linked graphs with explicit cross-repo edges for related ones, and automatic package-level scoping for monorepos.

Sia is fully local by default — all storage, embeddings, and AST analysis run on-device. No network dependency, no server required.

Sia optionally enables team knowledge sharing via a lightweight self-hosted sync server (single Docker container) with a clear visibility model.

Sia is installable in under three minutes via `npx sia install` and requires no developer understanding of graph databases, embedding models, or knowledge representation.

### 3.2 Non-Goals

Sia is not a general-purpose knowledge base, documentation tool, or note-taking system.

Sia does not replace human-authored architecture decision records or runbooks.

Sia does not provide a graphical UI in v1.

Sia does not require an always-on server in solo mode.

Sia does not aim to be a complete code-intelligence platform like Sourcegraph.

---

## 4. Core Concepts

### 4.1 The Three-Tier Memory Model

**Tier 1 — Working Memory** is the current session's context buffer. It holds recent conversation turns, in-progress file contents, active tool outputs, and the session's compacted progress note. It has a configurable token budget (default 8,000 tokens). When the budget fills, a compaction event fires: the current session is summarized into a structured progress note written to the semantic graph, and working memory resets.

**Tier 2 — Semantic Memory** is the persistent knowledge graph. It contains entities, typed bi-temporal edges between them, community summaries at multiple levels of abstraction, and the structural dependency graph from AST analysis. This is what survives between sessions.

**Tier 3 — Episodic Memory** is the non-lossy archive of all interactions. Every conversation turn, file read, command execution, and tool output is stored as a timestamped episode. This is the ground truth for re-extraction, forensic investigation, and temporal queries.

### 4.2 Entity Types

Sia recognizes seven entity types. Note that there is no separate "Architecture" type — discussions about architectural topics are captured as **Concept** entities tagged `["architecture"]`, keeping the type system minimal and consistent.

| Type | Represents |
|---|---|
| **CodeEntity** | Functions, classes, files, modules, packages — from AST analysis |
| **Concept** | Architectural ideas, patterns, abstractions discussed in conversation |
| **Decision** | Explicit choices made with rationale and alternatives considered |
| **Bug** | Specific defects with symptoms, root cause, and affected code |
| **Solution** | Fixes and workarounds, linked to the bugs they resolve |
| **Convention** | Project-specific rules about naming, style, testing, process |
| **Community** | Automatically discovered entity clusters from Leiden detection |

### 4.3 Bi-Temporal Model — Entities AND Edges

The bi-temporal model applies to **both entities and edges**. Every entity and every edge carries four temporal attributes:

- `t_created` — when Sia recorded this fact
- `t_expired` — when Sia marked it superseded (set by `invalidateEntity` or `invalidateEdge`)
- `t_valid_from` — when the fact became true in the world (may be null if unknown)
- `t_valid_until` — when the fact stopped being true in the world (null = still true)

Facts are never hard-deleted — only invalidated by setting `t_valid_until`. Queries default to "as of now" semantics, excluding invalidated facts. The `sia_at_time` tool returns the graph state at any historical point. This enables queries like "what was the authentication strategy in January?" or "when did we stop using Redis?"

### 4.4 Repositories, Workspaces, and Isolation

A **repository** is a single git repository root. Every repository gets its own SQLite database. Repositories are completely isolated from each other by default.

A **workspace** is a named group of related repositories. Cross-repo edges live in a shared `bridge.db`. Workspaces do not merge repo databases — they only enable cross-repo edges and cross-workspace retrieval.

A **monorepo** is a single git repository containing multiple packages. Sia detects monorepo structure from the underlying package manager — **not** from Turborepo-specific config. Detection precedence: `pnpm-workspace.yaml` → `package.json` `"workspaces"` field → `nx.json` with `project.json` files → `build.gradle` (Gradle multi-project). The presence of `turbo.json` signals a Turborepo project, but package paths are always sourced from the underlying package manager's config. Within a monorepo, all packages share a single `graph.db` scoped by `package_path`.

### 4.5 Language Support

Sia uses Tree-sitter for deterministic structural extraction. Languages are defined in a declarative registry in `src/ast/languages.ts`. The registry ships with three extraction tiers and can be extended at runtime via `config.json` without modifying source code.

**Tier A — Full extraction** (functions, classes, imports, call sites): TypeScript, TSX, JavaScript, JSX, Python, Go, Rust, Java, Kotlin, Swift, PHP, Ruby, Scala, Elixir, Dart.

**Tier B — Structural extraction** (functions, classes, imports; call tracking unreliable or absent): C (with `compile_commands.json` include-path resolution), C++ (same), C# (with `.csproj` reference detection), Bash/Shell, Lua, Zig, Perl, R, OCaml, Haskell.

**Tier C — Schema extraction** (custom extractors, not generic AST): SQL (tables, columns, foreign keys, indexes), Prisma schema.

**Note on GraphQL:** GraphQL schema files (`.graphql`, `schema.graphql`) are processed by the workspace API contract auto-detector (`src/workspace/api-contracts.ts`), not by the language registry. They produce cross-repo `api_contracts` entries, not entity extractions. GraphQL does not have a `LANGUAGE_REGISTRY` entry and does not appear in `src/ast/languages.ts`.

**Note on HTML:** HTML template extraction is deferred to a post-v1 release. It does not have a `LANGUAGE_REGISTRY` entry in v1.

**Tier D — Project manifest extraction** (project-level dependency declarations): `Cargo.toml`, `go.mod`, `pyproject.toml`, `.csproj`/`.sln`, `build.gradle`/`pom.xml`. These establish cross-repo and cross-package dependency edges without code-level analysis.

User-defined additional languages: specified in `config.json` under `additionalLanguages` with the npm package name of the Tree-sitter grammar and the desired tier.

### 4.6 Trust Tiers and Provenance

Every entity and edge carries a trust tier that affects its confidence score and retrieval ranking weight.

| Tier | Name | Default Confidence | Retrieval Multiplier | Rationale |
|---|---|---|---|---|
| 1 | User-Direct | 0.95 | **1.00** | Developer explicitly stated this fact in conversation |
| 2 | Code-Analysis | 0.92 | **0.90** | Deterministically extracted from AST; reliable but code can be ambiguous |
| 3 | LLM-Inferred | 0.70 | **0.70** | Probabilistic extraction; generally good, hallucination possible |
| 4 | External | 0.50 | **0.50** | Unknown provenance; may be poisoned, outdated, or wrong |

Tier 1 receives a retrieval multiplier of 1.00 (full weight). Tier 2 is discounted 10% to reflect that deterministic extraction can misinterpret ambiguous code constructs. The 20-point drop to Tier 3 reflects the probabilistic nature of LLM extraction. The 20-point drop to Tier 4 reflects untrusted provenance. Tier 4 content additionally passes through the security staging area.

### 4.7 Visibility and Team Sharing

Every entity has a visibility level. **Private (default):** only the creating developer's Sia instance sees this entity, it is never synced. **Team:** synced to all workspace members. **Project:** synced only to members of a specific workspace.

When team sharing is disabled (the default), the visibility field is inert — there is no server, no sync process, no network calls.

### 4.8 Community Detection and Retrieval

Leiden community detection discovers clusters of related entities at three hierarchy levels (fine, medium, coarse) with LLM-generated summaries. A RAPTOR summary tree provides multi-granularity retrieval: raw facts at Level 0, entity summaries at Level 1, module summaries at Level 2, architectural summaries at Level 3.

Retrieval combines three signals via Reciprocal Rank Fusion: vector similarity (local ONNX), BM25 keyword search (FTS5), and graph traversal from mentioned entities.

---

## 5. User Journeys

### 5.1 Solo Developer, Single Repo

A developer installs Sia with `npx sia install` in their project directory. Tree-sitter indexes the repository in the background. Claude Code's first `sia_search` call surfaces the structural graph. By week two, decisions made in previous sessions surface automatically when relevant. The developer never explains the project's architecture twice.

### 5.2 Solo Developer, Multi-Repo (TypeScript Frontend + C# Backend)

The developer runs `npx sia workspace create "Acme Fullstack" --repos ./frontend ./backend`. Sia creates a workspace. Cross-repo relationships are detected from the OpenAPI spec in the C# backend and from TypeScript project references in the frontend. When Claude Code works in the TypeScript frontend and calls `sia_by_file({ file: "src/services/UserService.ts" })`, results include both local TypeScript entities and the linked C# backend endpoint entities, complete with their authentication requirements and response types.

### 5.3 Small Team, Enabling Sharing

A five-developer team decides to share architectural knowledge. One developer runs `npx sia server start` on a VPS (the server is a single Docker container). Each team member runs `npx sia team join <server-url> <token>`. From that point, any entity promoted to `team` visibility syncs automatically. When the backend developer captures an architectural decision about JWT token expiry, every other developer's agent sees it the next time they ask about authentication.

### 5.4 Temporal Investigation

A performance regression appears. The developer asks Claude Code to investigate what changed about the caching strategy over the last two months. Claude calls `sia_at_time({ as_of: "60 days ago", tags: ["caching"] })`. Sia returns an invalidated Decision entity with `t_valid_until` set six weeks ago, linked via a `supersedes` edge to the current Decision entity. Claude explains exactly when the change happened, who captured it, and which files were affected.

### 5.5 Security Audit — Paranoid Mode

A developer is auditing third-party dependencies and doesn't want any knowledge extracted from external READMEs or documentation to enter the main graph, even if it passes all staging validation. They run `sia_search` with `paranoid: true`, which excludes all Tier 4 facts from results. They also set `paranoidCapture: true` in config, which causes the capture pipeline to quarantine all Tier 4 extractions at the chunker stage without running them through staging at all.

### 5.6 New Team Member Onboarding

A new developer joins and asks Claude Code "what are the main architectural components of this system?" Claude calls `sia_community({ query: "top-level architecture", level: 2 })`. Sia returns three coarse community summaries — the API layer, the background job system, and the data model — each describing key entities and relationships. The new developer has an accurate high-level map of a codebase they have never read, built automatically from months of their colleagues' sessions.

---

## 6. Functional Requirements

### 6.1 Multi-Repo and Workspace Management

The system must create an isolated SQLite database for each repository at `~/.sia/repos/<sha256-of-absolute-path>/graph.db`. Repositories must never share entity IDs, edges, or retrieval queries unless explicitly linked via a workspace.

The system must support named workspaces. Workspaces are stored in `~/.sia/meta.db`. Cross-repo edges are stored in `~/.sia/bridge.db` and queried via SQLite ATTACH.

The system must auto-detect monorepos from: `pnpm-workspace.yaml`, `package.json` `"workspaces"` field, `nx.json` with per-package `project.json`, and Gradle multi-project `settings.gradle`. **The presence of `turbo.json` alone must not be used to discover package paths** — it signals a Turborepo project, but package discovery must use the underlying package manager's config.

The system must detect API contracts automatically from: OpenAPI/Swagger specs, GraphQL schema files, `workspace:*` npm dependencies, TypeScript project references, `.csproj` `<ProjectReference>` elements, `Cargo.toml` `[dependencies]` workspace members, `go.mod` `replace` directives, and `pyproject.toml` path dependencies.

### 6.2 Language Support

The system must implement a declarative language registry in `src/ast/languages.ts`. The registry must be the single source of truth for which languages are supported and how they are extracted. Adding a new language must require only a registry entry — not source code changes in the extraction pipeline.

The registry must ship supporting all languages listed in §4.5. Special handling must be implemented for: C/C++ include-path resolution via `compile_commands.json`, C# `.csproj` project reference traversal, and SQL schema entity extraction (tables, columns, foreign keys, indexes as first-class graph entities).

Users must be able to register additional Tree-sitter grammars in `config.json` under `additionalLanguages` without modifying or rebuilding Sia.

### 6.3 Bi-Temporal Graph — Entities and Edges

Both entities and edges must carry `t_created`, `t_expired`, `t_valid_from`, and `t_valid_until`. Neither entities nor edges may be hard-deleted from the main graph. Invalidation sets `t_valid_until` on the target fact. All retrieval defaults to active-only (`t_valid_until IS NULL`). `sia_at_time` supports point-in-time queries for both entities and edges.

### 6.4 Local-First Architecture

All storage, vector embeddings, AST analysis, and retrieval must function with zero network calls when team sharing is disabled. An `airGapped: true` config flag disables all outbound network calls (Haiku API). Track B extraction, consolidation LLM calls, community summarisation, and the Rule of Two security check are all disabled. The local ONNX embedder and all retrieval signals (vector, BM25, graph traversal) continue to operate normally — the retrieval pipeline does not call LLMs and is unaffected by this flag. Consolidation falls back to direct-write mode (Track A candidates written as ADD without LLM disambiguation). See ARCHI §11.1 for the full per-code-path specification.

### 6.5 Security — Staging, Validation, and Paranoid Mode

Content from Tier 4 sources must pass through a physically isolated staging table (no foreign keys to the main graph) before reaching `entities` or `edges`. Three validation layers run before promotion: pattern injection detection, semantic domain consistency check, and confidence threshold enforcement. Meta's Rule of Two applies as an additional LLM-based check for Tier 4 ADD operations.

The system must support a `--paranoid` flag on `sia_search` that excludes all Tier 4 entities from results entirely. The system must support a `paranoidCapture: true` config flag that quarantines all Tier 4 chunks at the chunker stage of the capture pipeline, bypassing staging validation entirely. This provides a hard guarantee: no external content enters the graph, regardless of whether it would pass validation.

### 6.6 Team Sharing and Sync

When team sharing is enabled, entities with `visibility: "team"` or `visibility: "project"` must sync to a self-hosted `sqld` server using `@libsql/client` embedded replicas. Cross-repo edges from `bridge.db` that connect two team-visible entities must also sync. All timestamps must use Hybrid Logical Clocks (HLC). The sync model is eventual consistency. Genuine contradictions are flagged with `conflict_group_id` for team review.

The sync server does not run sqlite-vss. Vector indexes are local-only. After each sync pull, a post-sync VSS refresh step reads the `embedding` BLOB of each newly received entity and inserts it into the local `entities_vss` virtual table. This ensures vector search remains functional after sync without requiring VSS on the server side.

### 6.7 Sharing Rules

Sharing rules — which entity types default to which visibility level in which workspace — must be stored in `meta.db`, not in individual `graph.db` files. This ensures that all developers in a workspace apply the same auto-promotion rules regardless of which repo they captured a fact in. Rules are synced to all workspace members as part of the workspace metadata.

### 6.8 Three-Tier Memory Store

The system must maintain working memory (in-process, token-budgeted at 8,000 tokens default), semantic memory (SQLite per-repo), and episodic memory (append-only SQLite per-repo with FTS5). Compaction fires when the working memory budget is exceeded.

### 6.9 AST Backbone

Tree-sitter must parse the repository on install and re-parse incrementally on file changes. Extracted structural facts are written as Tier 2 entities. PersonalizedPageRank over the structural graph powers importance scoring.

### 6.10 Dual-Track Extraction and Consolidation

The capture pipeline runs Track A (NLP/AST, deterministic) and Track B (Haiku, probabilistic) in parallel. Both produce `CandidateFact[]`. Consolidation applies ADD / UPDATE / INVALIDATE / NOOP. Target compression rate: ≥80% of raw candidates result in NOOP or UPDATE.

### 6.11 Community Detection and Summaries

Leiden community detection runs automatically after graph updates exceeding a configurable threshold (default 20 new nodes, minimum graph size 100). Three hierarchy levels. LLM summaries cached by content hash.

### 6.12 MCP Tools

`sia_search` — hybrid search with `paranoid?` flag, `workspace?`, `task_type?`, `package_path?`.
`sia_by_file` — file-scoped retrieval with optional workspace mode.
`sia_expand` — BFS traversal with optional cross-repo traversal.
`sia_community` — community summaries by query or entity, with `package_path?` scoping.
`sia_at_time` — point-in-time query against bi-temporal graph.
`sia_flag` — mid-session signal (disabled by default).

The MCP server holds no write connection to `entities` or `edges`. The only table the MCP server writes to is `session_flags`.

The agent behavioral contract governing when and how these tools are called is specified in `CLAUDE.md`, which is auto-generated by `npx sia install` from the template at `src/agent/claude-md-template.md`. The full behavioral specification is in `SIA_CLAUDE_MD.md`. The data contracts for each tool are defined in ARCHI §6.1.

### 6.13 CLI Commands

`install`, `workspace create/list/add/remove/show`, `server start/stop/status`, `team join/leave/status`, `share <entity-id>`, `conflicts list/resolve`, `search [--paranoid]`, `stats`, `prune`, `export`, `import`, `rollback`, `reindex`, `community`, `download-model`, `enable-flagging`, `disable-flagging`.

---

## 7. Non-Functional Requirements

**Performance.** Three-stage hybrid search under 800ms for graphs up to 50,000 nodes. Incremental AST re-parse of a changed file under 200ms. Full capture pipeline under 8 seconds after hook fires. Workspace search via ATTACH under 1.2 seconds for two repos of up to 25,000 nodes each. Community detection on 10,000 nodes under 30 seconds. Post-sync VSS refresh under 2 seconds for batches of up to 500 new entities.

**Reliability.** No memory system failure may affect Claude Code operation. All pipeline steps have timeout guards. Circuit breakers engage after 3 consecutive LLM failures and switch to keyword-only fallback for 5 minutes.

**Privacy.** All data is local by default. When sync is enabled, only entities with `visibility: "team"` or `visibility: "project"` leave the machine. Private entities never touch the network. The sync transport uses HTTPS/TLS. Auth tokens are stored in the OS keychain, never in `config.json`.

**Storage.** Per-repo semantic graph: under 1GB for 50,000 nodes. Episodic archive: under 2GB for 12 months of active daily use. Bridge database: under 100MB for most workspaces. ONNX model: ~90MB, downloaded once.

**Security.** Staging area isolated by schema design (no FK to main graph). MCP server opens `graph.db` with `OPEN_READONLY`. All LLM prompts incorporating untrusted content use labeled delimiter injection. `paranoidCapture` mode provides a hard guarantee against Tier 4 content entering the graph.

**Compatibility.** macOS, Linux, Windows (WSL2). Node.js 18+ and Bun 1.0+. Standard MCP stdio transport.

**Extensibility.** Adding a new programming language must require only a config entry or a registry addition — not changes to the capture pipeline or AST indexer core.

---

## 8. Success Metrics

**Context re-explanation rate:** sessions where the developer re-explains something already captured should drop below 10% within the first month.

**Context efficiency:** average tokens injected per session through MCP tools should remain under 1,200 even on mature projects. This is a distributional average across a
mix of task types, not a per-session hard ceiling. The `maxResponseTokens` config
(default 1,500) means a single tool call can inject up to 1,500 tokens; three tool calls
at full response size could inject up to 4,500 tokens. The 1,200-token average is
achievable only when the agent uses `limit` appropriately — 5 for specific lookups, 10
for architectural queries — and respects the two-per-session `sia_expand` hard limit.
Sessions involving broad architectural orientation (e.g. new developer onboarding)
will intentionally exceed 1,200 tokens. The metric should be evaluated as a rolling
30-day average across a representative mix of task types, not per-session.

**Cross-repo retrieval accuracy:** `sia_search` with `workspace: true` should surface relevant cross-repo results in the top 5 for at least 60% of queries with cross-repo relevance.

**Team knowledge reuse:** at least 30% of `sia_search` results should come from a colleague's capture (not the querying developer's own sessions) within the first month of team sharing being enabled.

**Sync reliability:** team sync must achieve eventual consistency within 60 seconds of a write under normal network conditions.

---

## 9. Risks and Mitigations

**Memory poisoning.** Mitigation: staging area, three-layer write guard, Rule of Two, audit log with rollback, `--paranoid`/`paranoidCapture` modes.

**Cross-repo ATTACH limit.** SQLite defaults to 10 simultaneously attached databases. Mitigation: cross-repo queries are always scoped to a single workspace session; if a workspace exceeds 8 repos, queries round-robin through ATTACH/DETACH cycles. Compile-time limit can be raised to 125.

**Team sync conflicts.** Mitigation: bi-temporal model resolves most conflicts through temporal sequencing; genuine contradictions flagged with `conflict_group_id` for team review.

**ONNX embedding latency on older hardware.** Mitigation: install-time benchmark warns if latency exceeds 200ms; content-hash LRU cache eliminates re-embedding; `--no-embed` falls back to BM25-only retrieval.

**Leiden community detection on sparse graphs.** Mitigation: detection skipped below 100-node minimum; tag-based grouping serves as fallback.

**sqld + sqlite-vss compatibility.** The sync server does not need to run sqlite-vss. Vector indexes are rebuilt locally from the synced embedding BLOBs via post-sync VSS refresh. This is both the solution and a design constraint: the server is a sync relay only, not a query engine.

**Missing peer repo on workspace search.** If a workspace member's `graph.db` doesn't exist locally (a developer only installed Sia on some repos), the ATTACH fails gracefully: results from the missing repo are omitted, a warning is emitted to `sia.log`, and the result set includes a `missing_repos` metadata field.

**C/C++ include resolution.** Without `compile_commands.json`, relative `#include` edges may fail to resolve. Mitigation: Sia falls back to same-directory include resolution and emits a warning recommending `compile_commands.json` generation.

---

## 10. Future Directions

This section records potential future investments that are explicitly out of scope for v1.

**Sia Cloud.** A managed hosted version of the sync server for teams that want zero infrastructure. This would replace the self-hosted Docker container requirement. No design decisions for Sia Cloud are made in this document.

**Real-time collaborative editing of knowledge graph.** Currently, two developers editing the same team-visible entity produce a conflict that requires manual resolution. Future work could adopt a CRDT-based merge strategy (e.g., cr-sqlite) for automatic per-property merge.

**IDE plugin.** A VS Code or JetBrains plugin that surfaces Sia entities inline in the editor, without going through Claude Code, for developers who want direct graph access.

**OpenTelemetry-based runtime call detection.** Cross-repo API edge detection currently relies on static analysis of OpenAPI specs and TypeScript imports. Runtime tracing via OpenTelemetry would provide higher-accuracy cross-repo edges from actual observed network traffic.
