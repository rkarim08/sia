# Phase 15 — Five-Layer Graph Freshness Engine + Native Performance Module
## Sia v5 — Full Implementation Specification

**Version:** 1.0
**Status:** Draft
**Last Updated:** 2026-03-17
**Dependency:** All Phases 1–14 complete. This is the hardening phase that makes the graph trustworthy at scale.
**Estimated effort:** 62–80 hours across 12 tasks
**Languages:** TypeScript (primary), Rust (optional NAPI-RS native module with AST diffing, graph algorithms, and Leiden community detection)
**Intellectual foundation:** Salsa/Adapton incremental computation frameworks, Zep Graphiti temporal knowledge graph architecture, GumTree AST differencing, Ebbinghaus forgetting curve applied to knowledge graph confidence, SQLite performance tuning for bi-temporal models.

---

## 1. Overview and Rationale

Phase 15 solves the fundamental trust problem of a persistent knowledge graph: **how do you guarantee that facts derived from code remain accurate as the code evolves, without sacrificing the sub-millisecond retrieval performance the agent depends on?**

The answer is a layered architecture where each layer operates at a different timescale and cost profile, and where the choice of invalidation mechanism matches the nature of each fact type. AST-extracted facts are deterministic — they should use event-driven invalidation keyed to file changes, because time-based decay would cause unnecessary re-verification of unchanged code. LLM-inferred facts are probabilistic — they should use confidence decay with re-observation reinforcement, because the passage of time genuinely reduces confidence in unverified inferences. Documentation facts are semi-stable — they should use periodic cross-validation, because documentation drifts slowly and the cost of checking is high enough to warrant batching.

This phase also addresses the two genuine performance bottlenecks identified in the native code research: AST diffing (O(n²) matching phase, 5–20× faster in Rust) and iterative graph algorithms like PageRank (2–4× faster when running on a cached Rust petgraph structure versus JavaScript Maps over SQLite). Both are implemented as an optional Rust module that degrades gracefully to TypeScript when unavailable. The same Rust module also provides Leiden community detection via the `graphrs` crate, eliminating the need for a Python subprocess — JavaScript Louvain serves as the zero-overhead primary when the native module is unavailable.

---

## 2. The Five-Layer Freshness Architecture

### 2.1 Design Principles

**Different fact types demand different freshness strategies.** Applying a single mechanism (e.g., TTL-based expiry) to all facts is architecturally wrong. A function signature extracted from an AST is either correct or not — temporal decay is meaningless. A Decision inferred by an LLM six months ago might still be valid or might have been silently superseded — temporal decay is exactly right.

**Never scan the full graph.** The inverted dependency index (Task 15.1) ensures that every invalidation is O(affected nodes), not O(all nodes). For a 50K-node graph where a typical file change affects 5–20 nodes, this is the difference between 0.5ms and 500ms.

**Serve fast, validate async.** The stale-while-revalidate pattern (Layer 3) means retrieval latency is always < 1ms for cached facts. Validation happens in the background or inline via read-repair. The agent is never blocked waiting for freshness checks except in the rare case of rotten facts beyond the staleness window.

**Early cutoff prevents cascading invalidation.** Inspired by Salsa's core insight: if a source file changes but the derived fact is unchanged (e.g., whitespace-only edit, comment change), stop propagation immediately. This eliminates ~30% of unnecessary re-verification for typical editing sessions.

### 2.2 Layer Summary

```
Layer 1 — File-Watcher Invalidation     [milliseconds]   [>90% of cases]
  File save → Tree-sitter incremental → getChangedRanges → surgical invalidation
  ↓ (for changes outside watcher scope)
Layer 2 — Git-Commit Reconciliation      [seconds]        [merges, rebases, checkouts]
  Git op → diff parse → affected files → bounded BFS with firewalls
  ↓ (for queries accessing potentially-stale data)
Layer 3 — Stale-While-Revalidate Reads   [per-query]      [~0.1ms overhead]
  stat() check → Fresh/Stale/Rotten → serve or block → read-repair
  ↓ (for non-deterministic facts aging over time)
Layer 4 — Confidence Decay               [hours to days]  [LLM-inferred only]
  Exponential decay × trust tier → Bayesian re-observation reset
  ↓ (for deep validation of old facts)
Layer 5 — Periodic Deep Validation       [daily/weekly]   [batch cleanup]
  Doc-vs-code cross-check → LLM re-verify → PageRank → compaction
```

---

## 3. Inverted Dependency Index (Task 15.1)

### 3.1 Schema

```sql
-- Maps each source file to every graph node derived from it.
-- Maintained by triggers on graph_nodes and graph_edges.
CREATE TABLE source_deps (
  source_path  TEXT NOT NULL,     -- relative path from repo root
  node_id      TEXT NOT NULL REFERENCES graph_nodes(id),
  dep_type     TEXT NOT NULL,     -- 'defines' | 'extracted_from' | 'pertains_to' | 'references'
  source_mtime INTEGER NOT NULL,  -- file mtime at time of extraction (Unix ms)
  PRIMARY KEY (source_path, node_id)
);

CREATE INDEX idx_source_deps_path ON source_deps(source_path);
CREATE INDEX idx_source_deps_node ON source_deps(node_id);
```

### 3.2 Population Rules

The index is populated differently for each node kind, matching how each kind's content is derived from source files.

**CodeSymbol nodes** have a 1:1 mapping: the symbol was extracted from exactly one file. `dep_type = 'defines'`. The mapping is created when Track A (AST extraction) produces the CodeSymbol.

**FileNode nodes** map to themselves. `dep_type = 'defines'`. Trivially maintained.

**Decision, Convention, Concept nodes** are LLM-inferred and connect to code through `pertains_to` edges. Their source dependencies are the union of all files referenced by their `pertains_to` edges. `dep_type = 'pertains_to'`. The mapping is updated whenever a `pertains_to` edge is created or invalidated.

**ContentChunk nodes** from documentation ingestion map to the document file they were chunked from. `dep_type = 'extracted_from'`. Additionally, if the chunk has `references` edges to CodeSymbol/FileNode nodes, those files are secondary dependencies. `dep_type = 'references'`.

**Event nodes** (EditEvent, GitEvent, etc.) are NOT indexed in `source_deps` because they are historical facts that do not become stale — an EditEvent records that a file was edited at a specific time, and that fact remains true regardless of subsequent changes.

### 3.3 Cuckoo Filter for Fast Pre-Screening

An in-memory Cuckoo filter (rebuilt at startup from `source_deps`) provides O(1) answers to "does this file have ANY derived nodes?" The filter supports deletion (unlike Bloom filters), which is important when source dependencies change.

Sizing: for 50K unique source paths at 1% false positive rate, the filter occupies ~100KB of memory. Lookup time: ~50ns. False positive cost: one unnecessary inverted index query (~0.1ms), which is acceptable.

Rebuild at startup from `SELECT DISTINCT source_path FROM source_deps` takes < 100ms for 50K entries.

---

## 4. Dirty Propagation Engine (Task 15.7)

### 4.1 Architecture — Salsa-Inspired Two-Phase Model

The dirty propagation engine is the coordination layer that connects all five freshness layers. It maintains a lightweight in-memory state of which nodes are `clean`, `dirty`, or `maybe_dirty`, and orchestrates re-verification on demand.

```typescript
// src/freshness/dirty-tracker.ts

type DirtyState = 'clean' | 'dirty' | 'maybe_dirty';

// In-memory map — NOT persisted to SQLite. Rebuilt from source_deps at startup.
// Only tracks nodes that have been accessed or invalidated in this session.
// Nodes not in the map are assumed 'clean' (optimistic default).
const dirtyMap = new Map<string, DirtyState>();

// Durability tiers — nodes derived from durable sources skip dirty checking
// when only volatile sources change.
type Durability = 'volatile' | 'durable';
// volatile = user code (changes frequently, always checked)
// durable = node_modules, standard library (changes rarely, skip checking
//           unless explicitly invalidated by npm install / package.json change)
```

### 4.2 Phase 1 — Push (Active Dirty Marking)

When a source file changes (detected by Layer 1 or Layer 2):

```
1. Look up source_deps[changed_file] → affected_node_ids
2. For each affected_node_id:
   a. Set dirtyMap[node_id] = 'dirty'
   b. Traverse outgoing dependency edges (calls, imports, pertains_to) up to depth 2
   c. For each neighbor:
      - If neighbor.edge_count > 50 (firewall): set 'maybe_dirty', STOP
      - Else: set 'dirty', continue traversal
3. Total time: O(affected_nodes × avg_degree × depth)
   Typical: 15 nodes × 5 neighbors × 2 depth = 150 operations = < 0.5ms
```

### 4.3 Phase 2 — Pull (Lazy Re-Verification)

When a query accesses a node:

```
1. If dirtyMap[node_id] is undefined or 'clean': serve immediately
2. If 'dirty':
   a. Re-extract the node from its source file(s) via source_deps
   b. Compare new content hash to stored content hash
   c. If UNCHANGED (early cutoff): set 'clean', do NOT propagate to dependents
   d. If CHANGED: update node, set 'clean', mark dependents as 'dirty'
3. If 'maybe_dirty':
   a. Check source file mtime (Layer 3 stale check — one stat() call)
   b. If source unchanged: set 'clean'
   c. If source changed: promote to 'dirty', proceed as step 2
```

The early cutoff is the critical optimization: a whitespace-only edit or comment change triggers Tree-sitter re-parse (Layer 1) and marks nodes dirty (Phase 1), but when Phase 2 re-extracts the CodeSymbol and finds the signature unchanged, it clears the dirty flag without cascading. In typical editing sessions, early cutoff eliminates ~30–50% of re-verification work.

### 4.4 Durability Optimization

Nodes derived from files in `node_modules/`, standard library paths, or files unchanged for > 30 days are marked `durable`. When only volatile sources change (the typical case during active development), durable nodes skip Phase 1 entirely — they are never marked dirty. This eliminates ~30% of the graph from dirty-checking overhead.

Durability is recalculated when `package.json` or lock files change (indicating potential `node_modules` changes), or when `npx sia reindex` runs.

---

## 5. Confidence Decay Model (Task 15.5)

### 5.1 Trust-Tier-Specific Strategies

The core insight from the research: **AST-derived facts and LLM-inferred facts need fundamentally different freshness mechanisms.** Applying one model to both is architecturally wrong.

**Tier 2 (AST-derived, CodeSymbol/FileNode): Event-driven only, no time decay.**

```
confidence = source_file_unchanged ? base_confidence : 0.0
```

The confidence is binary: 1.0 when the source file's mtime matches the extraction timestamp, 0.0 when it doesn't. Re-extraction restores confidence to 1.0. Time plays no role — a function signature extracted 6 months ago from an unchanged file is exactly as reliable as one extracted 5 minutes ago.

**Tier 3 (LLM-inferred, Decision/Convention/Bug/Solution/Concept): Exponential decay with Bayesian re-observation.**

```
λ = ln(2) / half_life_days
decay_multiplier = { high_confidence: 1.0, low_confidence: 2.0 }
base_decay = base_confidence × e^(-λ × decay_multiplier × days_since_access)

# Bayesian re-observation model (stored in properties JSON)
α = successful_re_observations  (starts at 1)
β = contradictions              (starts at 0)
bayesian_confidence = α / (α + β)

# Combined confidence
confidence = min(base_decay, bayesian_confidence)
```

Each time an LLM-inferred fact is re-extracted from a new session and matches the existing fact, `α` is incremented — the fact becomes more confident over time through repeated confirmation. Each time a contradictory fact is extracted, `β` is incremented and the fact is flagged for review.

**Tier 1 (User-stated, via sia_note or conversation): Slow decay.**

Half-life of 30 days. Developer preferences and conventions are long-lived but not permanent. Re-observation resets confidence.

**Tier 4 (External): Fast decay.**

Half-life of 7 days, decay_multiplier 3.0×. External facts from ingested URLs or fetched documentation lose confidence rapidly unless re-confirmed.

### 5.2 Decay Parameters

| Fact Type | Half-Life | Decay Multiplier | Re-observation Boost |
|-----------|-----------|-------------------|---------------------|
| CodeSymbol (Tier 2) | ∞ (event-driven) | N/A | N/A — re-extracted on change |
| Decision (Tier 3 high) | 14 days | 1.0× | α += 1 per re-observation |
| Convention (Tier 3 high) | 21 days | 1.0× | α += 1 per re-observation |
| Bug/Solution (Tier 3) | 7 days | 1.5× | α += 1 per re-observation |
| Concept (Tier 3) | 14 days | 1.0× | α += 1 per re-observation |
| User-stated (Tier 1) | 30 days | 0.5× | α += 2 per re-observation |
| External (Tier 4) | 7 days | 3.0× | α += 1 per re-observation |
| Event nodes | 1 hour | 1.0× | N/A — historical, no re-observation |

---

## 6. Rust Native Module Design (Task 15.9)

### 6.1 Module Architecture

```
@sia/native (npm package — optional dependency)
├── @sia/native-darwin-arm64     # macOS Apple Silicon
├── @sia/native-darwin-x64       # macOS Intel
├── @sia/native-linux-x64-gnu    # Linux x64 (glibc 2.17+)
├── @sia/native-linux-x64-musl   # Linux x64 (musl/Alpine)
├── @sia/native-linux-arm64-gnu  # Linux ARM64
├── @sia/native-win32-x64-msvc   # Windows x64
└── @sia/native-wasm             # Universal Wasm fallback
```

### 6.2 API Surface

The Rust module exposes exactly two batch-oriented synchronous functions. The batch design amortizes the ~7ns NAPI-RS per-call overhead across many operations.

```typescript
// src/native/bridge.ts — the only import site for the native module

interface AstDiffResult {
  inserts:  Array<{ node_id: string; kind: string; name: string }>;
  removes:  Array<{ node_id: string }>;
  updates:  Array<{ node_id: string; old_name: string; new_name: string }>;
  moves:    Array<{ node_id: string; old_parent: string; new_parent: string }>;
}

interface GraphComputeResult {
  scores: Float64Array;       // indexed by node position in the input edge list
  node_ids: string[];         // parallel array mapping positions to node IDs
}

type GraphAlgorithm =
  | { kind: 'pagerank'; damping: number; iterations: number; seed_nodes?: string[] }
  | { kind: 'shortest_path'; source: string }
  | { kind: 'betweenness_centrality' }
  | { kind: 'connected_components' };

// Attempt to load native module, fall back to Wasm, fall back to TypeScript
let native: NativeModule | null = null;
try {
  native = require('@sia/native');
} catch {
  try {
    native = require('@sia/native-wasm');
  } catch {
    // Pure TypeScript fallback — no native code needed
    native = null;
  }
}

export function astDiff(
  oldTreeBytes: Uint8Array,
  newTreeBytes: Uint8Array,
  nodeIdMap: Map<number, string>,  // maps AST node indices to graph node IDs
): AstDiffResult {
  if (native) {
    return native.astDiff(oldTreeBytes, newTreeBytes, nodeIdMap);
  }
  return fallbackAstDiff(oldTreeBytes, newTreeBytes, nodeIdMap);
}

export function graphCompute(
  edges: Int32Array,         // flat [from, to, weight, from, to, weight, ...]
  nodeIds: string[],
  algorithm: GraphAlgorithm,
): GraphComputeResult {
  if (native) {
    return native.graphCompute(edges, nodeIds, algorithm);
  }
  return fallbackGraphCompute(edges, nodeIds, algorithm);
}

export function isNativeAvailable(): 'native' | 'wasm' | 'typescript' {
  if (native?.isNative) return 'native';
  if (native?.isWasm) return 'wasm';
  return 'typescript';
}
```

### 6.3 Rust Implementation Structure

```
sia-native/
├── Cargo.toml
├── src/
│   ├── lib.rs              # NAPI-RS entry point, exports astDiff + graphCompute
│   ├── ast_diff/
│   │   ├── mod.rs
│   │   ├── gumtree.rs      # GumTree matching algorithm (O(n²) → O(n log n))
│   │   └── edit_script.rs  # Convert matches to insert/remove/update/move ops
│   ├── graph/
│   │   ├── mod.rs
│   │   ├── pagerank.rs     # PersonalizedPageRank with seed set
│   │   ├── dijkstra.rs     # Single-source shortest path
│   │   ├── centrality.rs   # Betweenness centrality
│   │   └── components.rs   # Connected components (Tarjan)
│   └── cache.rs            # In-memory petgraph cache, reused across calls
├── build.rs                # NAPI-RS build configuration
└── __test__/
    └── index.spec.ts       # Comparison tests: native vs Wasm vs TypeScript
```

The `cache.rs` module maintains a cached `petgraph::Graph` structure (~6–8MB for 50K nodes / 200K edges) that persists across multiple `graphCompute` calls within the same process. The cache is invalidated when the edge list changes (detected by hashing the input `Int32Array`). This amortizes the ~5ms data transfer cost across multiple algorithm invocations — the second `graphCompute` call in a session skips the transfer entirely.

### 6.4 Performance Targets

| Operation | Rust Native | Wasm Fallback | TypeScript Fallback |
|-----------|------------|---------------|---------------------|
| AST diff (500-node trees) | < 10ms | < 25ms | < 100ms |
| PageRank (50K nodes, 30 iter) | < 20ms | < 50ms | < 80ms |
| Shortest path (50K nodes) | < 5ms | < 12ms | < 30ms |
| Betweenness centrality (10K) | < 50ms | < 120ms | < 300ms |
| Module load time | < 5ms | < 20ms | 0ms |

### 6.5 Cross-Compilation and Distribution

NAPI-RS v3 with `@napi-rs/cli` handles the full build matrix. CI runs in parallel GitHub Actions jobs:

```yaml
# .github/workflows/native.yml
strategy:
  matrix:
    settings:
      - target: x86_64-apple-darwin
        host: macos-13
      - target: aarch64-apple-darwin
        host: macos-14
      - target: x86_64-unknown-linux-gnu
        host: ubuntu-latest
        use-cross: true
      - target: x86_64-unknown-linux-musl
        host: ubuntu-latest
        use-cross: true
      - target: aarch64-unknown-linux-gnu
        host: ubuntu-latest
        use-cross: true
      - target: x86_64-pc-windows-msvc
        host: windows-latest
      - target: wasm32-wasip1-threads
        host: ubuntu-latest
```

Each platform-specific package is ~3–6MB. Installation via `optionalDependencies` in Sia's `package.json` adds < 5 seconds to `npm install`. No Rust toolchain is required on the user's machine.

---

## 7. Community Detection Bridge (Task 15.10)

### 7.1 Architecture: Zero-Process-Overhead Community Detection

The Python Leiden worker has been replaced with a two-tier in-process architecture that requires no subprocess, no Python dependency, no IPC, and no idle memory cost. JavaScript Louvain runs as the zero-overhead primary, and Rust Leiden (via the `graphrs` crate integrated into `@sia/native`) provides a transparent quality upgrade when the native module is available.

The research supporting this decision found that a persistent Python igraph + leidenalg worker consumes ~35–50 MB idle and ~85–135 MB peak — which is small in absolute terms (0.3–0.8% of 16GB) — but the real cost is installation friction, failure modes, and support burden. Meanwhile, JavaScript Louvain processes 50K nodes in < 1 second with ~0.2% modularity difference versus Leiden, and `graphrs` (v0.11.15, MIT license, pure Rust) provides a genuine Leiden implementation that integrates directly into the existing `@sia/native` NAPI-RS module with zero process overhead.

```
Community detection request
  ↓
detection-bridge.ts checks isNativeAvailable()
  ├── 'native' or 'wasm' → Rust Leiden via @sia/native (graphrs crate)
  │                         Uses cached petgraph structure from graphCompute
  │                         Three resolution levels, < 500ms for 50K nodes
  │
  └── 'typescript' → JavaScript Louvain (graphology-communities-louvain)
                     In-process, < 1 second for 50K nodes
                     + connected-components post-processing to split disconnected communities
```

### 7.2 JavaScript Louvain (Primary — Always Available)

`graphology-communities-louvain` is a production-grade JavaScript implementation that runs in-process with zero external dependencies. It serves as the always-available baseline and is fast enough for code knowledge graphs of any practical size.

```typescript
// src/community/detection-bridge.ts

import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { connectedComponents } from 'graphology-components';
import { isNativeAvailable, nativeLeiden } from '@/native/bridge';

interface CommunityResult {
  levels: Array<{
    membership: number[];       // community ID per node
    modularity: number;
    n_communities: number;
  }>;
  backend: 'rust-leiden' | 'js-louvain';
}

export function detectCommunities(
  edges: Array<[number, number, number]>,  // [from, to, weight]
  nodeCount: number,
  resolutions: number[] = [2.0, 1.0, 0.5],
): CommunityResult {
  // Prefer Rust Leiden when available — transparent upgrade
  if (isNativeAvailable() !== 'typescript') {
    return nativeLeiden(edges, nodeCount, resolutions);
  }

  // JavaScript Louvain with connected-components post-processing
  return louvainWithPostProcessing(edges, nodeCount, resolutions);
}

function louvainWithPostProcessing(
  edges: Array<[number, number, number]>,
  nodeCount: number,
  resolutions: number[],
): CommunityResult {
  // Build graphology graph
  const graph = new Graph({ type: 'undirected' });
  for (let i = 0; i < nodeCount; i++) graph.addNode(String(i));
  for (const [from, to, weight] of edges) {
    graph.addEdge(String(from), String(to), { weight });
  }

  const levels = resolutions.map(resolution => {
    // Run Louvain at this resolution
    const communities = louvain(graph, {
      resolution,
      getEdgeWeight: 'weight',
    });

    // Post-processing: split any disconnected communities.
    // Louvain can produce ~1% disconnected communities in a single pass.
    // This trivial O(V+E) step eliminates the issue entirely.
    const membership = splitDisconnectedCommunities(graph, communities);

    const uniqueCommunities = new Set(Object.values(membership));
    return {
      membership: Array.from({ length: nodeCount }, (_, i) => membership[String(i)] ?? -1),
      modularity: louvain.assign(graph, { resolution, getEdgeWeight: 'weight' }),
      n_communities: uniqueCommunities.size,
    };
  });

  return { levels, backend: 'js-louvain' };
}

// Split disconnected communities by running connected components
// within each community and assigning new IDs to disconnected parts.
function splitDisconnectedCommunities(
  graph: Graph,
  communities: Record<string, number>,
): Record<string, number> {
  const byCommunity = new Map<number, string[]>();
  for (const [node, comm] of Object.entries(communities)) {
    if (!byCommunity.has(comm)) byCommunity.set(comm, []);
    byCommunity.get(comm)!.push(node);
  }

  const result: Record<string, number> = {};
  let nextId = 0;

  for (const [, members] of byCommunity) {
    // Build subgraph for this community
    const subgraph = graph.copy();
    for (const node of graph.nodes()) {
      if (!members.includes(node)) subgraph.dropNode(node);
    }

    // Find connected components within the community
    const components = connectedComponents(subgraph);

    // Each connected component gets its own community ID
    for (const component of components) {
      for (const node of component) {
        result[node] = nextId;
      }
      nextId++;
    }
  }

  return result;
}
```

### 7.3 Rust Leiden (Native — When @sia/native Available)

The `graphrs` crate (v0.11.15, MIT license) provides a pure-Rust Leiden implementation with no C/C++ dependencies. It integrates into the existing `@sia/native` NAPI-RS module as a third API alongside `astDiff` and `graphCompute`. The integration reuses the cached `petgraph` graph structure from `graphCompute`, so if the graph has already been loaded for PageRank computation, the Leiden call pays zero data transfer cost.

```rust
// Added to sia-native/src/lib.rs

use graphrs::{Graph as GrsGraph, GraphSpecs};
use graphrs::algorithms::community::leiden::{leiden, QualityFunction};

#[napi]
pub fn leiden_communities(
    edges: Int32Array,          // flat [from, to, weight, ...]
    node_count: u32,
    resolutions: Vec<f64>,      // e.g., [2.0, 1.0, 0.5]
) -> Result<Vec<LeidenResult>> {
    // Build graphrs graph from edge list
    let mut graph = GrsGraph::<u32, f64>::new(GraphSpecs::undirected());
    for chunk in edges.chunks(3) {
        let (from, to, weight) = (chunk[0] as u32, chunk[1] as u32, chunk[2] as f64);
        graph.add_edge_with_weight(from, to, weight)?;
    }

    // Run Leiden at each resolution level
    let results = resolutions.iter().map(|&res| {
        let partition = leiden(
            &graph, true,
            QualityFunction::CPM,
            Some(res), None, None,
        )?;
        Ok(LeidenResult {
            membership: partition.membership().to_vec(),
            modularity: partition.quality(),
            n_communities: partition.num_communities(),
        })
    }).collect::<Result<Vec<_>>>()?;

    Ok(results)
}

#[napi(object)]
pub struct LeidenResult {
    pub membership: Vec<i32>,
    pub modularity: f64,
    pub n_communities: u32,
}
```

### 7.4 `npx sia doctor` Integration

The doctor command reports which community detection backend is active:

```
✓ @sia/native loaded (darwin-arm64)
→ Community detection: Rust Leiden via graphrs (native)

OR:

✓ @sia/native-wasm loaded
→ Community detection: Rust Leiden via graphrs (wasm)

OR:

✗ @sia/native not available
→ Community detection: JavaScript Louvain (in-process fallback)
  Install @sia/native for Leiden-quality communities
```

No Python is mentioned anywhere. No `pip install` instructions. The entire community detection pipeline runs in-process with zero external runtime dependencies.

---

## 8. SQLite Performance Hardening (Task 15.8)

### 8.1 Optimal PRAGMA Configuration

```sql
-- Applied at every write connection open (capture pipeline, event writer)
PRAGMA journal_mode = WAL;          -- 12× write throughput vs rollback
PRAGMA synchronous = NORMAL;        -- Safe in WAL mode, 2× faster than FULL
PRAGMA mmap_size = 1073741824;      -- 1GB virtual, demand-paged by OS
                                    -- 33% faster reads under concurrent load
PRAGMA temp_store = MEMORY;         -- Keep temp tables/indexes in RAM
PRAGMA cache_size = -64000;         -- 64MB page cache
PRAGMA page_size = 4096;            -- Match OS page size
PRAGMA foreign_keys = ON;           -- Enforce referential integrity
```

The `mmap_size = 1073741824` (1GB) reserves virtual address space, not physical RAM. Pages are demand-loaded by the OS kernel. This eliminates one full memory copy per page read compared to SQLite's default page cache, delivering 33–36% faster reads under concurrent workloads. Safe on all 64-bit systems.

### 8.2 Current-State Shadow Table

```sql
-- Maintained by triggers. Contains ONLY active, non-archived nodes.
-- Eliminates the temporal predicate from the most common query pattern.
CREATE TABLE current_nodes AS
  SELECT * FROM graph_nodes
  WHERE t_valid_until IS NULL AND archived_at IS NULL;

CREATE INDEX idx_current_kind ON current_nodes(kind);
CREATE INDEX idx_current_importance ON current_nodes(importance DESC);
CREATE INDEX idx_current_session ON current_nodes(session_id) WHERE session_id IS NOT NULL;

-- Trigger: when a node is invalidated, remove from current_nodes
CREATE TRIGGER shadow_invalidate
  AFTER UPDATE OF t_valid_until ON graph_nodes
  WHEN new.t_valid_until IS NOT NULL AND old.t_valid_until IS NULL
BEGIN
  DELETE FROM current_nodes WHERE id = new.id;
END;

-- Trigger: when a node is archived, remove from current_nodes
CREATE TRIGGER shadow_archive
  AFTER UPDATE OF archived_at ON graph_nodes
  WHEN new.archived_at IS NOT NULL AND old.archived_at IS NULL
BEGIN
  DELETE FROM current_nodes WHERE id = new.id;
END;

-- Trigger: when a new active node is inserted, add to current_nodes
CREATE TRIGGER shadow_insert
  AFTER INSERT ON graph_nodes
  WHEN new.t_valid_until IS NULL AND new.archived_at IS NULL
BEGIN
  INSERT INTO current_nodes SELECT * FROM graph_nodes WHERE id = new.id;
END;

-- Trigger: when a node is reactivated, add to current_nodes
CREATE TRIGGER shadow_reactivate
  AFTER UPDATE OF t_valid_until ON graph_nodes
  WHEN new.t_valid_until IS NULL AND old.t_valid_until IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO current_nodes SELECT * FROM graph_nodes WHERE id = new.id;
END;
```

Queries that need only current-state data (the vast majority of retrieval queries) read from `current_nodes` instead of `graph_nodes`, avoiding the `WHERE t_valid_until IS NULL AND archived_at IS NULL` predicate entirely. For a graph where 90% of rows are historical versions, this reduces the effective table size by 10×.

### 8.3 Partial Index Audit Checklist

Every hot-path query must use a partial index. Verify with `EXPLAIN QUERY PLAN`:

```sql
-- All these indexes should have WHERE clauses matching the query predicates
CREATE INDEX idx_nodes_kind_active ON graph_nodes(kind)
  WHERE archived_at IS NULL AND t_valid_until IS NULL;
CREATE INDEX idx_nodes_importance_active ON graph_nodes(importance DESC)
  WHERE archived_at IS NULL AND t_valid_until IS NULL;
CREATE INDEX idx_edges_from_active ON graph_edges(from_id)
  WHERE t_valid_until IS NULL;
CREATE INDEX idx_edges_to_active ON graph_edges(to_id)
  WHERE t_valid_until IS NULL;
CREATE INDEX idx_source_deps_path ON source_deps(source_path);
```

---

## 9. Freshness-Aware Search Results (Task 15.11)

### 9.1 SiaSearchResult Extension

Each search result now carries a `freshness` field:

```typescript
interface SiaSearchResult {
  // ... existing fields ...

  freshness: 'fresh' | 'stale' | 'rotten';
  freshness_detail?: {
    source_path: string;          // the source file this fact depends on
    source_mtime: number;         // when the source was last modified
    extraction_time: number;      // when this fact was extracted
    divergence_seconds: number;   // source_mtime - extraction_time
    confidence: number;           // current confidence after decay
    alpha?: number;               // Bayesian re-observation count (Tier 3 only)
    beta?: number;                // Bayesian contradiction count (Tier 3 only)
  };
}
```

### 9.2 Agent Behavioral Rules

The CLAUDE.md base module gains:

**Invariant 9:** "Never state an LLM-inferred fact (trust_tier 3) as definitive if its confidence has decayed below 0.5. Always qualify: 'Sia's memory suggests X — confidence has decreased since last verification, let me check the current code.'"

**Step 2 freshness rules:**
- `freshness: 'fresh'` → use normally, cite with confidence
- `freshness: 'stale'` → qualify: "This may not reflect the latest code — extracted from [file] which was modified [time ago]." Verify via sandbox if the fact is decision-critical.
- `freshness: 'rotten'` → should be rare (Layer 3 blocks on these). If encountered, re-query after validation completes.

---

## 10. Directory Layout (Additions to ARCHI §13)

```
sia/
├── src/
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
│   └── community/
│       └── detection-bridge.ts     # Louvain primary + Rust Leiden when native available
│
├── sia-native/                     # Rust NAPI-RS module (separate crate)
│   ├── Cargo.toml                  # deps: petgraph, graphrs, tree-sitter
│   ├── src/
│   │   ├── lib.rs                  # NAPI exports: astDiff, graphCompute, leidenCommunities
│   │   ├── ast_diff/
│   │   ├── graph/
│   │   ├── leiden.rs               # graphrs Leiden wrapper
│   │   └── cache.rs
│   └── __test__/
│       └── index.spec.ts           # Native vs Wasm vs TS comparison tests
│
└── migrations/
    └── graph/003_freshness.sql     # source_deps + current_nodes + shadow triggers
```

---

## 11. Migration Note (graph/003_freshness.sql)

The freshness migration adds `source_deps`, `current_nodes` (shadow table), and the shadow maintenance triggers. It also seeds `source_deps` from existing graph data: for each CodeSymbol node, extract the source file from its `defines` edge; for each semantic node, extract source files from its `pertains_to` edges.

The initial population of `current_nodes` is a one-time `INSERT INTO current_nodes SELECT * FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL`, which may take 1–5 seconds on a 50K-node graph. Subsequent maintenance is incremental via triggers.

---

## 12. Performance Budget Summary

| Operation | Target Latency | Layer |
|-----------|---------------|-------|
| Fresh node retrieval | < 0.05ms | Cached in current_nodes |
| Stale check (per node) | < 0.2ms | One stat() syscall |
| Read-repair (single file) | 10–100ms | Tree-sitter re-parse + consolidation |
| File-save invalidation | < 200ms total | Layer 1 end-to-end |
| Git-commit reconciliation | < 2s for 5 files | Layer 2 end-to-end |
| Dirty propagation (10K graph) | < 1ms | In-memory BFS |
| Early cutoff check | < 0.5ms | Content hash comparison |
| AST diff (Rust native) | < 10ms | Via NAPI-RS |
| PageRank (Rust native) | < 20ms | Via NAPI-RS cached petgraph |
| Maintenance deep validation | < 60s total | Layer 5 background job |
| Cuckoo filter lookup | < 0.05ms | In-memory |
