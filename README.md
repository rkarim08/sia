# Sia

**Persistent graph memory for AI coding agents.**

> *Sia was the Egyptian personification of perception, insight, and divine knowledge. She rode on the prow of Ra's solar barque and was said to write knowledge on the heart — the precise act of embedding structured understanding into a store that shapes all future reasoning.*

---

## Why Sia?

Every time you close a Claude Code session, the agent forgets everything. Decisions made Monday are invisible Friday. Bugs analyzed last week get rediscovered from scratch. Conventions established over days must be re-explained. Across a month of daily development, this represents hours of compounding lost effort — and across a team, the problem multiplies because each developer's agent independently rebuilds the same understanding of the same codebase.

Sia solves this by capturing knowledge from your AI coding sessions automatically and storing it in a local, bi-temporal knowledge graph. Between sessions, your agent retrieves only what's relevant to the current task. No explicit input required. No server required. Everything runs locally.

### How Sia Differs from Existing Solutions

| Capability | CLAUDE.md (manual) | claude-mem | **Sia** |
|---|---|---|---|
| **Storage model** | Flat text file | Key-value store | Typed knowledge graph with edges |
| **Relationships** | None — facts are isolated lines | None | Typed, weighted edges (calls, supersedes, caused_by, solves, ...) |
| **Temporal awareness** | None — stale facts persist forever | Manual deletion | Bi-temporal: every fact has valid-from/valid-until; nothing is deleted, only invalidated |
| **Time-travel queries** | Not possible | Not possible | `sia_at_time` queries the graph at any historical point |
| **Retrieval** | Entire file injected every session | Keyword search | Hybrid: vector similarity + BM25 + graph traversal with trust-weighted RRF reranking |
| **Context cost** | Grows unbounded with project maturity | Grows with entries | ~1,200 tokens average per session (only relevant facts retrieved) |
| **Code structure** | Not captured | Not captured | AST-powered structural backbone via Tree-sitter (30+ languages) |
| **Multi-repo** | One file per repo, no cross-repo awareness | Single store, no repo concept | Workspace model with cross-repo edges and API contract detection |
| **Team sharing** | Copy-paste or shared file | Not supported | Optional sync via self-hosted server with visibility controls |
| **Security** | No write validation | No write validation | 4-tier trust model, isolated staging area, paranoid mode, audit log with rollback |
| **Scalability** | Collapses past ~50 entries | Linear degradation | SQLite-backed, tested to 50K nodes with sub-800ms retrieval |
| **Capture method** | Developer writes manually | Developer writes manually | Automatic dual-track: deterministic AST + probabilistic LLM |
| **Knowledge decay** | Manual cleanup | Manual cleanup | Automatic importance decay with configurable half-lives per entity type |

**The core difference:** Existing solutions treat memory as a growing text file or key-value store. Sia treats memory as a **typed, temporal, relational knowledge graph** — the same data structure that makes knowledge useful to humans (connections, context, history) also makes it useful to AI agents.

---

## Quick Start

### Installation

```bash
npx sia install
```

This takes under three minutes and:
1. Creates the `~/.sia/` directory structure
2. Downloads the local embedding model (~90MB ONNX, runs on-device)
3. Indexes your repository with Tree-sitter
4. Generates a `CLAUDE.md` in your project with agent behavioral instructions
5. Registers Sia as an MCP server for Claude Code

No knowledge of graph databases, embedding models, or knowledge representation required.

### First Session

After installation, just use Claude Code normally. Sia works in the background:

- **During the session**: Claude Code calls Sia's MCP tools automatically to retrieve relevant context before acting on tasks. You'll see tool calls like `sia_search` and `sia_by_file` in your session.
- **After the session**: Sia's capture pipeline extracts knowledge from the session — decisions you made, bugs you found, conventions you established — and writes them to the graph.
- **Next session**: When you start a new session, Claude Code queries Sia for context relevant to whatever you're working on. Decisions from last week surface automatically. You never re-explain.

### What Gets Captured

Sia captures seven types of knowledge automatically:

| Type | What It Captures | Example |
|------|-----------------|---------|
| **CodeEntity** | Functions, classes, files, modules | `UserService.authenticate()` — handles JWT validation |
| **Concept** | Architectural ideas, patterns | "We use the repository pattern for all DB access" |
| **Decision** | Choices with rationale and alternatives | "Chose Express over Fastify because of middleware ecosystem" |
| **Bug** | Defects with symptoms and root cause | "Race condition in EventEmitter.on() — fires before DB ready" |
| **Solution** | Fixes linked to the bugs they resolve | "Added await to init() — ensures DB connection before event binding" |
| **Convention** | Project-specific rules | "All errors must extend AppBaseError" |
| **Community** | Auto-discovered module clusters | "Authentication subsystem: UserService, JWTProvider, AuthMiddleware" |

### Verifying It Works

```bash
# Check graph statistics
npx sia stats

# Search the knowledge graph directly
npx sia search "authentication architecture"

# View community summaries
npx sia community
```

---

## How It Works

### Automatic Capture

When a Claude Code session ends (or during specific hook events), Sia's capture pipeline runs:

1. **Dual-track extraction** processes the session transcript:
   - **Track A (deterministic)**: Tree-sitter parses code changes; NLP extracts structured facts
   - **Track B (probabilistic)**: Haiku LLM extracts semantic knowledge from conversation
2. **Two-phase consolidation** merges extracted candidates against the existing graph:
   - Finds the top-5 semantically similar existing entities for each candidate
   - Decides: ADD (new fact), UPDATE (merge into existing), INVALIDATE (supersede old fact), or NOOP (duplicate, discard)
   - Target: ≥80% of candidates are NOOP or UPDATE — the graph stays compact
3. **Atomic write** commits all changes in a single transaction with a full audit log

### Intelligent Retrieval

When Claude Code calls a Sia tool, the retrieval engine combines three signals:

1. **Vector similarity** — local ONNX embeddings matched via sqlite-vss
2. **BM25 keyword search** — SQLite FTS5 full-text search
3. **Graph traversal** — follows edges from mentioned entities (1-hop expansion)

Results are fused via Reciprocal Rank Fusion and weighted by:
- **Trust tier** (developer-stated facts rank higher than LLM-inferred ones)
- **Task type** (bug-fix boosts Bug/Solution entities; feature boosts Concept/Decision)
- **Importance** (decays over time; frequently accessed and well-connected facts rank higher)

### Trust Tiers

Every fact in the graph carries a trust tier that affects retrieval ranking and how the agent treats it:

| Tier | Source | Confidence | Agent Behavior |
|------|--------|------------|----------------|
| 1 | **User-Direct** — developer explicitly stated this | 0.95 | Treat as ground truth; cite directly |
| 2 | **Code-Analysis** — deterministically extracted from AST | 0.92 | Highly reliable; verify only for safety-critical claims |
| 3 | **LLM-Inferred** — probabilistic extraction from conversation | 0.70 | Qualify before acting: "Sia suggests X — let me verify" |
| 4 | **External** — from READMEs, docs, or unknown sources | 0.50 | Reference only; never sole basis for code changes |

### Bi-Temporal Knowledge Graph

Every fact (entities and edges) carries four timestamps:

- **`t_created`** — when Sia recorded the fact
- **`t_expired`** — when Sia marked it superseded
- **`t_valid_from`** — when the fact became true in the world
- **`t_valid_until`** — when it stopped being true (null = still true)

Facts are never deleted — only invalidated. This enables powerful temporal queries:

```bash
# What was the authentication strategy in January?
# (Claude Code calls sia_at_time automatically during regression investigation)
npx sia search "authentication" --as-of "2026-01-01"
```

When investigating a regression, Claude Code uses `sia_at_time` to find exactly which facts changed between "when it worked" and "when it broke" — with specific entity citations, not speculation.

---

## MCP Tools

Sia exposes six tools that Claude Code calls on demand via the Model Context Protocol:

### `sia_search` — General Memory Retrieval

The primary tool. Called at the start of every non-trivial task.

```
sia_search({
  query: "session timeout expiry behavior",
  task_type: "bug-fix",         // boosts Bug, Solution entities
  node_types: ["Decision"],     // narrow by entity type
  limit: 10,                    // default 5; use 10 for architectural queries
  paranoid: true,               // exclude all external (Tier 4) content
  workspace: true,              // include cross-repo results
})
```

### `sia_by_file` — File-Scoped Retrieval

Called before modifying any file. Returns everything Sia knows about that file: decisions, bugs, patterns, conventions.

```
sia_by_file({
  file_path: "src/services/UserService.ts",
  workspace: true,    // include cross-repo edges for this file
})
```

### `sia_expand` — Graph Relationship Traversal

Follows edges from a known entity to understand how it connects to the rest of the graph. Session budget: 2 calls.

```
sia_expand({
  entity_id: "...",
  depth: 2,
  edge_types: ["supersedes", "caused_by", "solves"],
})
```

### `sia_community` — Architectural Summaries

Returns synthesized module-level descriptions from Leiden community detection. Used for orientation and architectural questions.

```
sia_community({
  query: "how does the auth module work",
  level: 1,    // 0=fine, 1=module, 2=architectural overview
})
```

### `sia_at_time` — Temporal Query

Queries the graph at a historical point. Essential for regression investigation.

```
sia_at_time({
  as_of: "30 days ago",
  entity_types: ["Decision", "Solution"],
  tags: ["caching"],
})
```

Returns two arrays: `entities[]` (facts still valid at that time) and `invalidated_entities[]` (facts that had ended by then — the diagnostic signal for regressions).

### `sia_flag` — Mid-Session Capture Signal (opt-in)

Marks an important moment for higher-priority capture. Disabled by default.

```
sia_flag({ reason: "chose express-rate-limit at route level, not middleware" })
```

---

## Multi-Repo Workspaces

Sia supports three repository models:

### Single Repository (default)

Each repo gets an isolated SQLite database at `~/.sia/repos/<hash>/graph.db`. No cross-contamination.

### Workspace (linked repos)

Group related repositories with explicit cross-repo edges:

```bash
npx sia workspace create "Acme Fullstack" --repos ./frontend ./backend
```

Cross-repo relationships are auto-detected from:
- OpenAPI / Swagger specs
- GraphQL schema files
- TypeScript project references
- `.csproj` `<ProjectReference>` elements
- `Cargo.toml` workspace members
- `go.mod` `replace` directives
- `pyproject.toml` path dependencies
- `workspace:*` npm dependencies

When Claude Code works in the frontend and calls `sia_by_file`, results include both local entities and linked backend endpoint entities — with authentication requirements, response types, and API contracts.

### Monorepo

Auto-detected from package manager config. All packages share one `graph.db` scoped by `package_path`:

- `pnpm-workspace.yaml`
- `package.json` `"workspaces"` field
- `nx.json` with `project.json` files
- Gradle multi-project `settings.gradle`

The presence of `turbo.json` is logged but never used for package discovery — that always comes from the underlying package manager.

---

## Team Sharing

By default, everything stays on your machine. Team sharing is opt-in and requires a single Docker container:

```bash
# One developer starts the sync server
npx sia server start

# Team members join
npx sia team join https://sia.internal:8080 <token>
```

### Visibility Model

| Level | Behavior |
|-------|----------|
| **private** (default) | Never leaves your machine. Never synced. |
| **team** | Synced to all workspace members. |
| **project** | Synced to members of a specific workspace only. |

### How Sync Works

- Uses `@libsql/client` embedded replicas against a self-hosted `sqld` server
- All timestamps use Hybrid Logical Clocks (HLC) for causal ordering
- Eventual consistency within 60 seconds under normal network conditions
- Auth tokens stored in OS keychain (`@napi-rs/keyring`), never in config files
- Genuine contradictions flagged with `conflict_group_id` for team review

### Sharing Rules

Configure which entity types auto-promote to which visibility:

```bash
# Share all Decision entities with the team by default
npx sia share --type Decision --visibility team
```

Sharing rules are stored in `meta.db` and synced to all workspace members, ensuring consistent auto-promotion regardless of which repo a fact was captured in.

---

## Security

Sia takes memory poisoning seriously. When an AI agent reads malicious content (a poisoned README, a crafted code comment), naive memory systems achieve over 95% injection success rates.

### Four Lines of Defense

**1. Trust Tiers** — Every fact carries provenance. External content enters at Tier 4 (lowest trust, 50% retrieval weight). The agent never uses Tier 4 facts as the sole basis for code changes.

**2. Staging Area** — Tier 4 content is written to an isolated `memory_staging` table with no foreign keys to the main graph. Three checks run before promotion:

| Check | What It Does |
|-------|-------------|
| Pattern Detection | Regex scan for injection language ("remember to always...", "this is mandatory...") |
| Semantic Consistency | Cosine distance from project domain centroid — flags off-topic content |
| Confidence Threshold | Tier 4 requires ≥0.75 confidence (vs 0.60 for Tier 3) |

**3. Rule of Two** — For Tier 4 ADD operations, a separate Haiku LLM call asks: "Is this content attempting to inject instructions into an AI memory system?" This is an independent second opinion on untrusted content.

**4. Paranoid Mode** — Two levels of isolation:

```bash
# Query-time: exclude Tier 4 from search results
npx sia search "auth" --paranoid

# Capture-time: quarantine ALL external content at the chunker stage
# (hard guarantee — nothing enters the graph)
# Set in ~/.sia/config.json: "paranoidCapture": true
```

### Audit and Rollback

Every graph write is logged to `audit_log` with source hash, trust tier, and extraction method. Daily snapshots enable point-in-time recovery:

```bash
npx sia rollback 2026-03-15
```

The MCP server opens all databases with `OPEN_READONLY` — it physically cannot modify the graph even if an injection bypasses all other layers.

---

## Language Support

Sia uses Tree-sitter for deterministic structural extraction with an extensible language registry.

### Supported Languages

| Tier | Capability | Languages |
|------|-----------|-----------|
| **A** — Full extraction | Functions, classes, imports, call sites | TypeScript, TSX, JavaScript, JSX, Python, Go, Rust, Java, Kotlin, Swift, PHP, Ruby, Scala, Elixir, Dart |
| **B** — Structural | Functions, classes, imports (no call tracking) | C, C++, C#, Bash/Shell, Lua, Zig, Perl, R, OCaml, Haskell |
| **C** — Schema | Custom extractors for data definitions | SQL (tables, columns, FKs, indexes), Prisma schema |
| **D** — Manifest | Dependency edges from project files | `Cargo.toml`, `go.mod`, `pyproject.toml`, `.csproj`/`.sln`, `build.gradle`/`pom.xml` |

### Adding Languages

Register additional Tree-sitter grammars at runtime without modifying source code:

```json
// ~/.sia/config.json
{
  "additionalLanguages": [
    {
      "name": "gleam",
      "extensions": [".gleam"],
      "grammar": "tree-sitter-gleam",
      "tier": "B"
    }
  ]
}
```

---

## CLI Reference

### Core Commands

```bash
npx sia install                     # Install and index the repository
npx sia stats                       # Graph statistics (entity count, edge count, etc.)
npx sia search <query>              # Search the knowledge graph
npx sia search --paranoid <query>   # Search excluding all Tier 4 content
npx sia reindex                     # Re-parse the AST backbone
npx sia prune                       # Clean up decayed entities
npx sia export                      # Export graph for backup or migration
npx sia import                      # Import a previously exported graph
npx sia rollback <timestamp>        # Restore graph to a previous state
```

### Workspace Commands

```bash
npx sia workspace create "My App" --repos ./frontend ./backend
npx sia workspace list
npx sia workspace show "My App"
npx sia workspace add "My App" ./shared-lib
npx sia workspace remove "My App" ./old-service
```

### Team Commands

```bash
npx sia server start                # Start the sync server (Docker)
npx sia server stop
npx sia server status
npx sia team join <url> <token>     # Join a team
npx sia team leave
npx sia team status
npx sia share <entity-id>           # Promote entity to team visibility
npx sia conflicts list              # View unresolved contradictions
npx sia conflicts resolve           # Resolve a contradiction
```

### Knowledge Commands

```bash
npx sia community                   # View community summaries
npx sia download-model              # Download/update the ONNX embedding model
npx sia enable-flagging             # Enable sia_flag mid-session capture
npx sia disable-flagging
```

---

## Configuration

All configuration lives in `~/.sia/config.json`. Created automatically by `npx sia install`.

### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `captureModel` | `claude-haiku-4-5-20251001` | LLM used for extraction, consolidation, and security checks |
| `minExtractConfidence` | `0.6` | Minimum confidence for LLM-extracted candidates |
| `paranoidCapture` | `false` | Quarantine all Tier 4 content at chunker stage (hard guarantee) |
| `enableFlagging` | `false` | Enable `sia_flag` for mid-session capture |
| `airGapped` | `false` | Disable all outbound network calls (LLM). ONNX embedder unaffected. |
| `maxResponseTokens` | `1500` | Max tokens per MCP tool response |
| `workingMemoryTokenBudget` | `8000` | Token budget before working memory compaction |
| `communityTriggerNodeCount` | `20` | New entities before community re-detection triggers |
| `communityMinGraphSize` | `100` | Minimum graph size for Leiden to run |
| `archiveThreshold` | `0.05` | Importance below which decayed, disconnected entities are archived |

### Decay Half-Lives

| Entity Type | Half-Life | Rationale |
|-------------|-----------|-----------|
| Decision | 90 days | Architectural decisions have long relevance |
| Convention | 60 days | Team patterns evolve gradually |
| Bug / Solution | 45 days | Bug context decays as code changes |
| Default | 30 days | General knowledge decays faster |

### Air-Gapped Mode

Set `"airGapped": true` to run Sia with zero outbound network calls. This disables:
- Track B LLM extraction (Track A AST continues normally)
- Two-phase consolidation (falls back to direct-write)
- Community summary generation (serves cached summaries)
- Rule of Two security check (deterministic checks still run)

The ONNX embedder, vector search, BM25, and graph traversal are all local and unaffected.

### Sync Configuration

```json
{
  "sync": {
    "enabled": false,
    "serverUrl": null,
    "developerId": null,
    "syncInterval": 30
  }
}
```

Auth tokens are stored in the OS keychain, never in this file.

---

## Storage

All data lives in `~/.sia/`:

```
~/.sia/
  meta.db                               # workspace/repo registry, sharing rules
  bridge.db                             # cross-repo edges
  config.json                           # user configuration
  repos/<sha256-of-repo-path>/
    graph.db                            # semantic graph (entities, edges, communities)
    episodic.db                         # append-only interaction archive
  models/
    all-MiniLM-L6-v2.onnx              # local embedding model (~90MB)
  ast-cache/<hash>/                     # Tree-sitter parse cache
  snapshots/<hash>/YYYY-MM-DD.snapshot  # daily graph snapshots
  logs/sia.log                          # structured JSON log
```

### Storage Limits

| Store | Budget |
|-------|--------|
| Per-repo semantic graph | <1GB for 50K nodes |
| Episodic archive | <2GB for 12 months of daily use |
| Bridge database | <100MB for most workspaces |
| ONNX model | ~90MB, downloaded once |

---

## Performance Targets

| Operation | Target |
|-----------|--------|
| Hybrid search (50K nodes) | <800ms |
| Incremental AST re-parse | <200ms per file |
| Full capture pipeline | <8s after hook fires |
| Workspace search (2 × 25K nodes) | <1.2s |
| Community detection (10K nodes) | <30s |
| Post-sync VSS refresh (500 entities) | <2s |

---

## Architecture

Sia is composed of eight modules: storage, capture pipeline, community engine, retrieval engine, MCP server, security layer, decay engine, and team sync.

**Write path**: Hook fires → dual-track extraction (AST + LLM) → two-phase consolidation (ADD/UPDATE/INVALIDATE/NOOP) → atomic graph write

**Read path**: MCP query → three-stage retrieval (vector + BM25 + graph traversal) → RRF reranking → context assembly

For the full architecture with module details, data flow diagrams, database schemas, and design rationale, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Compatibility

- **OS**: macOS, Linux, Windows (WSL2)
- **Runtime**: Node.js 18+, Bun 1.0+
- **Transport**: Standard MCP stdio
- **AI Agent**: Claude Code (primary), any MCP-compatible agent

---

## Status

Sia is under active development. Phase 1 (storage foundation) is complete with 139 passing tests.

---

## License

TBD
