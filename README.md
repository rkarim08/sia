# Sia

**Persistent graph memory for AI coding agents.**

> *Sia was the Egyptian personification of perception, insight, and divine knowledge. She rode on the prow of Ra's solar barque and was said to write knowledge on the heart — the precise act of embedding structured understanding into a store that shapes all future reasoning.*

---

## Why Sia?

Every time you close a Claude Code session, the agent forgets everything. Decisions made Monday are invisible Friday. Bugs analyzed last week get rediscovered from scratch. Conventions established over days must be re-explained. Across a month of daily development, this represents hours of compounding lost effort — and across a team, the problem multiplies because each developer's agent independently rebuilds the same understanding of the same codebase.

Sia solves this by capturing knowledge from your AI coding sessions automatically and storing it in a local, bi-temporal knowledge graph. Between sessions, your agent retrieves only what's relevant to the current task. No explicit input required. No server required. Everything runs locally.

### How Sia Differs from Existing Solutions

| Capability | CLAUDE.md (manual) | claude-mem | Obsidian + plugins | **Sia** |
|---|---|---|---|---|
| **Storage model** | Flat text file | Key-value store | Markdown vault with wikilinks | Unified knowledge graph with typed nodes and edges |
| **Relationships** | None — facts are isolated lines | None | Wikilinks (untyped, manual) | Typed, weighted edges (calls, supersedes, caused_by, solves, pertains_to, ...) |
| **Ontology enforcement** | None | None | None — any link to any note | Declarative edge constraints — invalid relationships rejected at write time |
| **Temporal awareness** | None — stale facts persist forever | Manual deletion | Git history (manual) | Bi-temporal: every fact has valid-from/valid-until; nothing is deleted, only invalidated |
| **Time-travel queries** | Not possible | Not possible | Manual git checkout | `sia_at_time` queries the graph at any historical point |
| **Retrieval** | Entire file injected every session | Keyword search | Full-text search + backlinks | Hybrid: vector similarity + BM25 + graph traversal with trust-weighted RRF reranking |
| **Context cost** | Grows unbounded with project maturity | Grows with entries | Manual copy-paste to agent | ~1,200 tokens average per session (only relevant facts retrieved) |
| **Code structure** | Not captured | Not captured | Not captured | AST-powered structural backbone via Tree-sitter (30+ languages) |
| **Documentation ingestion** | Not captured | Not captured | Manual note creation | Auto-discovers and indexes AGENTS.md, CLAUDE.md, ADRs, README.md, and 15+ doc formats |
| **Agent integration** | Injected at session start | MCP tool calls | None native; requires manual bridging | Native MCP server with 16 tools, automatic hook-based capture |
| **Sandbox execution** | N/A | N/A | N/A | Isolated subprocess execution with context-aware output indexing |
| **Session continuity** | Lost on compaction | Lost on compaction | N/A | Priority-weighted subgraph serialization survives context compaction |
| **Knowledge authoring** | Developer writes manually | Developer writes manually | Developer writes manually (rich editor) | `sia_note` for deliberate knowledge entry + automatic dual-track capture |
| **Multi-repo** | One file per repo, no cross-repo awareness | Single store, no repo concept | One vault, manual organization | Workspace model with cross-repo edges and API contract detection |
| **Team sharing** | Copy-paste or shared file | Not supported | Git sync or Obsidian Sync ($) | Optional sync via self-hosted server with visibility controls |
| **Security** | No write validation | No write validation | No trust model | 4-tier trust model, ontology enforcement, isolated staging area, paranoid mode, audit log with rollback |
| **Scalability** | Collapses past ~50 entries | Linear degradation | Degrades past ~10K notes | SQLite-backed, tested to 50K nodes with sub-800ms retrieval |
| **Capture method** | Developer writes manually | Developer writes manually | Developer writes manually | Automatic dual-track: deterministic AST + probabilistic LLM |
| **Knowledge decay** | Manual cleanup | Manual cleanup | Manual cleanup | Automatic importance decay with configurable half-lives per node kind |
| **Visualization** | Not available | Not available | Graph view (built-in) | Interactive D3.js graph explorer (`npx sia graph`) |
| **Export** | N/A | N/A | Native markdown | Obsidian-compatible markdown vault export/import (round-trip) |

**The core difference:** CLAUDE.md and claude-mem treat memory as flat text or key-value stores. Obsidian provides rich manual knowledge management but has no AI agent integration — the developer must bridge the gap manually. Sia treats memory as a **typed, temporal, ontology-enforced knowledge graph** with native agent integration — the same data structure that makes knowledge useful to humans (connections, context, history) also makes it useful to AI agents, and knowledge flows automatically between sessions without manual curation.

---

## Quick Start

### Installation

```bash
npx sia install
```

This takes under three minutes and:
1. Creates the `~/.sia/` directory structure
2. Downloads the local embedding model (~90MB ONNX, runs on-device)
3. Discovers and indexes repository documentation (AGENTS.md, CLAUDE.md, ADRs, README.md, etc.)
4. Indexes your repository structure with Tree-sitter
5. Generates a `CLAUDE.md` in your project with agent behavioral instructions
6. Registers Sia as an MCP server for Claude Code with all 16 tools
7. Installs hooks (PostToolUse, Stop, UserPromptSubmit, PreCompact, SessionStart)

No knowledge of graph databases, embedding models, or knowledge representation required.

### First Session

After installation, just use Claude Code normally. Sia works in the background:

- **During the session**: Claude Code calls Sia's MCP tools automatically to retrieve relevant context before acting on tasks. You'll see tool calls like `sia_search` and `sia_by_file` in your session. Every tool use, file edit, and command execution is recorded as an event node in the graph.
- **Session continuity**: When Claude Code compacts context, Sia serializes a priority-weighted subgraph of the current session. When the session resumes, Sia rebuilds context from the graph — no knowledge is lost to compaction.
- **After the session**: Sia's capture pipeline extracts knowledge from the session — decisions you made, bugs you found, conventions you established — and writes them to the graph.
- **Next session**: When you start a new session, Claude Code queries Sia for context relevant to whatever you're working on. Decisions from last week surface automatically. You never re-explain.

### What Gets Captured

Sia uses a unified graph with a `kind` discriminator. Nodes fall into three categories:

**Structural nodes** — the code backbone:

| Kind | What It Represents | Example |
|------|-------------------|---------|
| **CodeSymbol** | Functions, classes, modules | `UserService.authenticate()` — handles JWT validation |
| **FileNode** | Source files and documentation files | `src/auth/service.ts` |
| **PackageNode** | Packages in monorepos | `packages/auth` |

**Semantic nodes** — developer knowledge:

| Kind | What It Captures | Example |
|------|-----------------|---------|
| **Concept** | Architectural ideas, patterns | "We use the repository pattern for all DB access" |
| **Decision** | Choices with rationale and alternatives | "Chose Express over Fastify because of middleware ecosystem" |
| **Bug** | Defects with symptoms and root cause | "Race condition in EventEmitter.on() — fires before DB ready" |
| **Solution** | Fixes linked to the bugs they resolve | "Added await to init() — ensures DB connection before event binding" |
| **Convention** | Project-specific rules | "All errors must extend AppBaseError" |
| **Community** | Auto-discovered module clusters | "Authentication subsystem: UserService, JWTProvider, AuthMiddleware" |
| **ContentChunk** | Indexed documentation sections, execution output | Heading-scoped chunks from ARCHITECTURE.md |

**Event nodes** — session timeline:

| Kind | What It Captures | Example |
|------|-----------------|---------|
| **SessionNode** | A Claude Code session | Session started at 10:30 AM, 45 events |
| **EditEvent** | File modifications | Modified `src/auth/jwt.ts` lines 42-58 |
| **ExecutionEvent** | Command/script runs | `bun run test` — 3 failures |
| **ErrorEvent** | Errors encountered | TypeError: Cannot read property 'token' of undefined |
| **GitEvent** | Git operations | Committed `fix: token refresh` on branch `auth-fix` |
| **UserDecision** | Developer corrections | "Use Redis instead of Memcached" |
| **UserPrompt** | Developer messages | Prompt with references to entities |
| **TaskNode** | Logical task groupings | "Implement JWT refresh token flow" |

### Verifying It Works

```bash
# Check graph statistics
npx sia stats

# Search the knowledge graph directly
npx sia search "authentication architecture"

# View community summaries
npx sia community

# Health check — runtimes, hooks, model, graph integrity
npx sia doctor

# Visualize the graph in your browser
npx sia graph --open
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                       Claude Code                           │
│                                                             │
│   You code normally. Sia works in the background.           │
└──────────┬──────────────────────────────────┬───────────────┘
           │                                  │
     hooks fire on                    MCP tool calls
     every action                   (automatic retrieval)
           │                                  │
           ▼                                  ▼
┌─────────────────────┐         ┌──────────────────────────┐
│   WRITE PATH        │         │   READ PATH              │
│                     │         │                          │
│  PostToolUse ──┐    │         │  sia_search ◄── query    │
│  Stop ─────────┤    │         │  sia_by_file             │
│  UserPrompt ───┤    │         │  sia_expand              │
│  PreCompact ───┤    │         │  sia_community           │
│  SessionStart ─┘    │         │  sia_at_time             │
│       │             │         │  sia_note                │
│       ▼             │         │  sia_execute + 8 more    │
│  Event nodes        │         │       │                  │
│  Dual-track extract │         │       ▼                  │
│  Ontology validate  │         │  Vector + BM25 + Graph   │
│  Consolidate        │         │  ──► RRF reranking       │
│       │             │         │  ──► Trust weighting     │
│       ▼             │         │       │                  │
└───────┬─────────────┘         └───────┬──────────────────┘
        │                               │
        ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    ~/.sia/repos/<hash>/                      │
│                                                             │
│   graph.db ─── Unified knowledge graph                      │
│   ├── Structural: CodeSymbol, FileNode, PackageNode         │
│   ├── Semantic:   Decision, Convention, Bug, Solution       │
│   ├── Events:     EditEvent, ExecutionEvent, ErrorEvent     │
│   ├── Docs:       ContentChunk (from AGENTS.md, ADRs, ...) │
│   └── Ontology:   edge_constraints (validates all writes)   │
│                                                             │
│   episodic.db ─ Append-only session archive                 │
└─────────────────────────────────────────────────────────────┘
```

### Automatic Capture

When a Claude Code session ends (or during specific hook events), Sia's capture pipeline runs:

1. **Event node creation** — every hook event (PostToolUse, Stop, UserPromptSubmit) creates a typed event node in the graph with edges to related files, symbols, and the current session
2. **Dual-track extraction** processes the session transcript:
   - **Track A (deterministic)**: Tree-sitter parses code changes into CodeSymbol/FileNode nodes with structural edges (defines, imports, calls)
   - **Track B (probabilistic)**: Haiku LLM extracts semantic knowledge (Decisions, Conventions, Bugs) from conversation
3. **Two-phase consolidation** merges extracted candidates against the existing graph:
   - Finds the top-5 semantically similar existing nodes for each candidate
   - Decides: ADD (new fact), UPDATE (merge into existing), INVALIDATE (supersede old fact), or NOOP (duplicate, discard)
   - All edges validated against the ontology constraint layer before commit
   - Target: ≥80% of candidates are NOOP or UPDATE — the graph stays compact
4. **Atomic write** commits all changes in a single transaction with a full audit log

### Session Continuity

Sia preserves context across Claude Code's context compaction events:

1. **PreCompact hook**: When compaction is about to occur, Sia serializes a priority-weighted subgraph of the current session (events, decisions, modified files) into a compact JSON format (≤2 KB). P1 events (errors, user decisions) are always included; P4 events (routine searches) are dropped first.
2. **SessionStart hook**: When the session resumes, Sia deserializes the subgraph, re-queries the graph for the current state of referenced nodes, and injects a Session Guide with: last prompt, active tasks, modified files, unresolved errors, and key decisions.

### Documentation Ingestion

Sia auto-discovers and indexes repository documentation at install time, during reindex, and via the file watcher:

**Priority 1 — AI context files** (trust tier 1, tagged `ai-context`):
AGENTS.md, CLAUDE.md, GEMINI.md, .cursor/rules/*.mdc, .windsurf/rules/*.md, .clinerules/*.md, .github/copilot-instructions.md, .amazonq/rules/*.md, .continue/rules/*.md

**Priority 2 — Architecture docs** (trust tier 1, tagged `architecture`):
ARCHITECTURE.md, DESIGN.md, docs/adr/*.md, docs/decisions/*.md

**Priority 3 — Project docs** (trust tier 1, tagged `project-docs`):
README.md, CONTRIBUTING.md, CONVENTIONS.md, CONTEXT.md, docs/*.md

**Priority 4 — API docs** (trust tier 2, tagged `api-docs`):
openapi.yaml, swagger.json, schema.graphql, API.md

**Priority 5 — Change history** (trust tier 2, tagged `changelog`):
CHANGELOG.md, HISTORY.md, MIGRATION.md

Each document is chunked by heading boundaries, with code blocks kept intact and cross-references resolved to graph edges. Mentions of known code symbols in documentation create `references` edges, connecting prose knowledge to the structural backbone.

Documentation freshness is tracked via git metadata — when a document's last modification significantly predates changes to the code it describes (default: 90 days), it is tagged `potentially-stale` and ranks lower in search results.

### Ontology Enforcement

Every edge in the graph is validated against a declarative `edge_constraints` table that defines all valid (source_kind, edge_type, target_kind) triples. Invalid relationships are rejected at write time by SQLite triggers — before they can enter the graph. Additional constraints enforced at the application layer:

- **Co-creation**: A Bug node must have a `caused_by` edge (no orphaned bugs)
- **Cardinality**: A Convention node must have ≥1 `pertains_to` edge (conventions must govern something)
- **Type matching**: `supersedes` edges can only connect nodes of the same kind
- **Deletion guards**: Cannot remove a Convention's last `pertains_to` edge

### Intelligent Retrieval

When Claude Code calls a Sia tool, the retrieval engine combines three signals:

1. **Vector similarity** — local ONNX embeddings matched via sqlite-vss
2. **BM25 keyword search** — SQLite FTS5 full-text search
3. **Graph traversal** — follows edges from mentioned nodes (1-hop expansion)

Results are fused via Reciprocal Rank Fusion and weighted by:
- **Trust tier** (developer-stated facts rank higher than LLM-inferred ones)
- **Task type** (bug-fix boosts Bug/Solution nodes; feature boosts Concept/Decision)
- **Importance** (decays over time; frequently accessed and well-connected facts rank higher)
- **Graph proximity** (nodes closer to query-mentioned entities score higher)

Progressive throttling prevents excessive tool calls: normal results for calls 1–3, reduced results with warning for calls 4–8, blocked with redirect to `sia_batch_execute` for calls 9+.

### Trust Tiers

Every fact in the graph carries a trust tier that affects retrieval ranking and how the agent treats it:

| Tier | Source | Confidence | Agent Behavior |
|------|--------|------------|----------------|
| 1 | **User-Direct** — developer explicitly stated this or authored documentation | 0.95 | Treat as ground truth; cite directly |
| 2 | **Code-Analysis** — deterministically extracted from AST or API specs | 0.92 | Highly reliable; verify only for safety-critical claims |
| 3 | **LLM-Inferred** — probabilistic extraction from conversation | 0.70 | Qualify before acting: "Sia suggests X — let me verify" |
| 4 | **External** — from fetched URLs or unknown sources | 0.50 | Reference only; never sole basis for code changes |

### Bi-Temporal Knowledge Graph

Every fact (nodes and edges) carries four timestamps:

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

When investigating a regression, Claude Code uses `sia_at_time` to find exactly which facts changed between "when it worked" and "when it broke" — with specific node citations, not speculation.

---

## MCP Tools

Sia exposes 16 tools that Claude Code calls on demand via the Model Context Protocol, organized into four categories.

### Memory Tools

#### `sia_search` — General Memory Retrieval

The primary tool. Called at the start of every non-trivial task.

```
sia_search({
  query: "session timeout expiry behavior",
  task_type: "bug-fix",         // boosts Bug, Solution nodes
  node_types: ["Decision"],     // narrow by node kind
  limit: 10,                    // default 5; use 10 for architectural queries
  paranoid: true,               // exclude all external (Tier 4) content
  workspace: true,              // include cross-repo results
})
```

#### `sia_by_file` — File-Scoped Retrieval

Called before modifying any file. Returns everything Sia knows about that file: decisions, bugs, patterns, conventions.

```
sia_by_file({
  file_path: "src/services/UserService.ts",
  workspace: true,    // include cross-repo edges for this file
})
```

#### `sia_expand` — Graph Relationship Traversal

Follows edges from a known node to understand how it connects to the rest of the graph. Session budget: 2 calls.

```
sia_expand({
  node_id: "...",
  depth: 2,
  edge_types: ["supersedes", "caused_by", "solves"],
})
```

#### `sia_community` — Architectural Summaries

Returns synthesized module-level descriptions from Leiden community detection. Used for orientation and architectural questions.

```
sia_community({
  query: "how does the auth module work",
  level: 1,    // 0=fine, 1=module, 2=architectural overview
})
```

#### `sia_at_time` — Temporal Query

Queries the graph at a historical point. Essential for regression investigation.

```
sia_at_time({
  as_of: "30 days ago",
  node_types: ["Decision", "Solution"],
  tags: ["caching"],
})
```

Returns two arrays: `nodes[]` (facts still valid at that time) and `invalidated_nodes[]` (facts that had ended by then — the diagnostic signal for regressions).

#### `sia_flag` — Mid-Session Capture Signal (opt-in)

Marks an important moment for higher-priority capture. Disabled by default.

```
sia_flag({ reason: "chose express-rate-limit at route level, not middleware" })
```

#### `sia_note` — Developer-Authored Knowledge

Create a Tier 1 knowledge node with explicit tags and edges. Supports templates for structured formats like ADRs.

```
sia_note({
  kind: "Decision",
  name: "Use Redis for session cache",
  content: "Chose Redis over Memcached because...",
  relates_to: ["src/cache/redis.ts"],  // creates pertains_to edges
  template: "adr",                      // optional structured template
})
```

#### `sia_backlinks` — Incoming Edge Traversal

Returns all nodes that reference a given node, grouped by edge type. The graph-native equivalent of Obsidian's backlink panel.

```
sia_backlinks({
  node_id: "...",
  edge_types: ["pertains_to", "caused_by"],
})
```

### Sandbox Tools

#### `sia_execute` — Isolated Subprocess Execution

Run code in an isolated subprocess with stdout capture. Supports 11 runtimes. When output exceeds the context threshold and an intent is provided, Context Mode activates: output is chunked, embedded, indexed as ContentChunk nodes, and only relevant chunks are returned.

```
sia_execute({
  language: "python",
  code: "import json; print(json.dumps(analyze_logs()))",
  intent: "find OOM errors",    // triggers Context Mode for large output
})
```

#### `sia_execute_file` — File Processing in Sandbox

Like `sia_execute` but mounts a file into the sandbox. Raw content never enters the agent's context.

```
sia_execute_file({
  file_path: "logs/production.log",
  language: "python",
  code: "parse_and_summarize()",
})
```

#### `sia_batch_execute` — Multi-Command Batch

Execute multiple commands and searches in one call. Creates event nodes with `precedes` edges linking them in order.

```
sia_batch_execute({
  operations: [
    { type: "execute", language: "bash", code: "git log --oneline -20" },
    { type: "search", query: "recent authentication changes" },
    { type: "execute", language: "python", code: "analyze_diff()" },
  ]
})
```

#### `sia_index` — Content Indexing

Chunk markdown by headings, create ContentChunk nodes with embeddings, and cross-reference to known code symbols.

```
sia_index({
  content: "# API Documentation\n...",
  source: "api-docs",
})
```

#### `sia_fetch_and_index` — URL Fetch and Index

Fetch a URL, detect content type (HTML→markdown, JSON→structured), chunk and index as ContentChunk nodes with trust_tier 4.

```
sia_fetch_and_index({
  url: "https://docs.example.com/api",
})
```

### Diagnostic Tools

#### `sia_stats` — Graph Metrics

Returns node counts by kind, edge counts by type, context savings (session + total), and search/execute call counts.

#### `sia_doctor` — Health Check

Checks runtimes, hooks, FTS5, sqlite-vss, ONNX model, and graph integrity (orphan edges, bi-temporal invariants, ontology violations).

#### `sia_upgrade` — Self-Update

Fetches latest version, rebuilds, reconfigures hooks, runs migrations, and rebuilds VSS if the schema changed.

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

When Claude Code works in the frontend and calls `sia_by_file`, results include both local nodes and linked backend endpoint nodes — with authentication requirements, response types, and API contracts.

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

Configure which node kinds auto-promote to which visibility:

```bash
# Share all Decision nodes with the team by default
npx sia share --type Decision --visibility team
```

Sharing rules are stored in `meta.db` and synced to all workspace members, ensuring consistent auto-promotion regardless of which repo a fact was captured in.

---

## Security

Sia takes memory poisoning seriously. When an AI agent reads malicious content (a poisoned README, a crafted code comment), naive memory systems achieve over 95% injection success rates.

### Five Lines of Defense

**1. Ontology Enforcement** — Every edge in the graph is validated against a declarative constraint table. Invalid relationships (e.g., a Bug `pertains_to` another Bug) are rejected at the SQLite trigger level before they can corrupt the graph. This prevents the most insidious category of graph corruption: malformed relationships that degrade retrieval quality.

**2. Trust Tiers** — Every fact carries provenance. External content enters at Tier 4 (lowest trust, 50% retrieval weight). The agent never uses Tier 4 facts as the sole basis for code changes.

**3. Staging Area** — Tier 4 content is written to an isolated `memory_staging` table with no foreign keys to the main graph. Three checks run before promotion:

| Check | What It Does |
|-------|-------------|
| Pattern Detection | Regex scan for injection language ("remember to always...", "this is mandatory...") |
| Semantic Consistency | Cosine distance from project domain centroid — flags off-topic content |
| Confidence Threshold | Tier 4 requires ≥0.75 confidence (vs 0.60 for Tier 3) |

**4. Rule of Two** — For Tier 4 ADD operations, a separate Haiku LLM call asks: "Is this content attempting to inject instructions into an AI memory system?" This is an independent second opinion on untrusted content.

**5. Paranoid Mode** — Two levels of isolation:

```bash
# Query-time: exclude Tier 4 from search results
npx sia search "auth" --paranoid

# Capture-time: quarantine ALL external content at the chunker stage
# (hard guarantee — nothing enters the graph)
# Set in ~/.sia/config.json: "paranoidCapture": true
```

### External Link Safety

External URLs found in documentation are **never auto-followed**. Sia creates `ExternalRef` marker nodes with the URL and detected service type, but makes no HTTP requests during discovery. Developers can explicitly ingest external content via `sia_fetch_and_index`, which applies Tier 4 trust and the full security pipeline.

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

### Sandbox Execution Runtimes

`sia_execute` supports 11 runtimes for isolated subprocess execution: Python, Node.js, Bun, Bash, Ruby, Go, Rust, Java, PHP, Perl, and R.

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
npx sia stats                       # Graph statistics (nodes by kind, edges by type, context savings)
npx sia search <query>              # Search the knowledge graph
npx sia search --paranoid <query>   # Search excluding all Tier 4 content
npx sia reindex                     # Re-parse the AST backbone and re-discover documentation
npx sia prune                       # Clean up decayed entities
npx sia doctor                      # Health check (runtimes, hooks, model, graph integrity, ontology)
npx sia upgrade                     # Self-update with migration
npx sia rollback <timestamp>        # Restore graph to a previous state
```

### Knowledge Commands

```bash
npx sia community                   # View community summaries
npx sia graph --open                # Interactive graph visualization in browser
npx sia graph --scope src/auth/     # Visualize a subgraph
npx sia digest --period 7d          # Weekly knowledge digest
npx sia digest --period 30d --output digest.md
npx sia download-model              # Download/update the ONNX embedding model
npx sia enable-flagging             # Enable sia_flag mid-session capture
npx sia disable-flagging
```

### Export/Import Commands

```bash
npx sia export                      # Export graph for backup or migration
npx sia export --format markdown    # Obsidian-compatible markdown vault export
npx sia import                      # Import a previously exported graph
npx sia import --format markdown <dir>  # Import from markdown vault
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
npx sia share <node-id>             # Promote node to team visibility
npx sia conflicts list              # View unresolved contradictions
npx sia conflicts resolve           # Resolve a contradiction
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
| `communityTriggerNodeCount` | `20` | New nodes before community re-detection triggers |
| `communityMinGraphSize` | `100` | Minimum graph size for Leiden to run |
| `archiveThreshold` | `0.05` | Importance below which decayed, disconnected nodes are archived |
| `sandboxTimeout` | `30000` | Subprocess execution timeout (ms) |
| `contextModeThreshold` | `5000` | Output bytes before Context Mode activates |
| `freshnessDivergenceThreshold` | `90` | Days before documentation is flagged as potentially stale |
| `freshnessPenalty` | `0.15` | Importance penalty for stale documentation |

### Decay Half-Lives

| Node Kind | Half-Life | Rationale |
|-----------|-----------|-----------|
| Decision | 90 days | Architectural decisions have long relevance |
| Convention | 60 days | Team patterns evolve gradually |
| Bug / Solution | 45 days | Bug context decays as code changes |
| Default (semantic) | 30 days | General knowledge decays faster |
| Event nodes | 1 hour | Session events are transient |
| Session-flag-derived | 7 days | Flagged moments need rapid validation |

### Air-Gapped Mode

Set `"airGapped": true` to run Sia with zero outbound network calls. This disables:
- Track B LLM extraction (Track A AST continues normally)
- Two-phase consolidation (falls back to direct-write)
- Community summary generation (serves cached summaries)
- Rule of Two security check (deterministic checks still run)

The ONNX embedder, vector search, BM25, graph traversal, sandbox execution, and documentation ingestion are all local and unaffected.

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
    graph.db                            # unified graph (nodes, edges, communities, ontology)
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
| Per-repo graph | <1GB for 50K nodes |
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
| Post-sync VSS refresh (500 nodes) | <2s |
| Sandbox execution (simple script) | <5s |
| Graph visualization (100 nodes) | <3s render |
| Documentation discovery (≤50 files) | <2s |

---

## Architecture

Sia is composed of eleven modules: storage, capture pipeline, community engine, retrieval engine, MCP server, security layer, decay engine, team sync, sandbox execution engine, ontology layer, and knowledge/documentation engine.

**Write path**: Hook fires → event node creation → dual-track extraction (AST + LLM) → ontology validation → two-phase consolidation (ADD/UPDATE/INVALIDATE/NOOP) → atomic graph write

**Read path**: MCP query → three-stage retrieval (vector + BM25 + graph traversal) → RRF reranking with trust weighting → progressive throttling → context assembly

**Session continuity path**: PreCompact → priority-weighted subgraph serialization → SessionStart → subgraph deserialization + graph re-query → Session Guide injection

For the full architecture with module details, data flow diagrams, database schemas, and design rationale, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Compatibility

- **OS**: macOS, Linux, Windows (WSL2)
- **Runtime**: Node.js 18+, Bun 1.0+
- **Transport**: Standard MCP stdio
- **AI Agent**: Claude Code (primary), any MCP-compatible agent
- **Documentation formats**: AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules, Windsurf rules, Copilot instructions, and 15+ more

---

## Status

Sia is under active development.

---

## License

TBD
