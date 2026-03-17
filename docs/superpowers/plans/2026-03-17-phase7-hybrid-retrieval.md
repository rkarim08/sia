# Phase 7: Full Hybrid Retrieval — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `sia_search` from importance-ordered SQL to a full three-stage hybrid retrieval pipeline: parallel BM25 + vector + graph traversal in Stage 1, graph-aware expansion in Stage 2, RRF reranking with trust weighting in Stage 3.

**Architecture:** Each retrieval signal (BM25, vector, graph traversal) is a standalone module returning ranked candidate lists. The reranker combines them via Reciprocal Rank Fusion (k=60) with trust-tier weights and task-type boosts. A query classifier routes broad queries to community summaries (global) and specific queries to the three-stage pipeline (local). The existing `workspace: true` routing from Phase 5 is preserved.

**Tech Stack:** Bun, TypeScript strict, SiaDb adapter, FTS5 (entities_fts), ONNX embedder (all-MiniLM-L6-v2), Vitest with better-sqlite3 shim, Biome 2.x

**Branch:** `phase-7/hybrid-retrieval`

**Important:** Do NOT add Co-Authored-By to commit messages. Run tests via `npx vitest run` (not `bun run test`).

**Sequencing note:** Task 6 modifies `src/mcp/tools/sia-search.ts` which Phase 5 already modified for `workspace: true`. The workspace routing MUST be preserved -- Phase 7 upgrades the local-search path only.

---

## File Structure

### Files to replace (existing stubs):
- `src/retrieval/bm25-search.ts` -- FTS5 MATCH query with normalized rank
- `src/retrieval/graph-traversal.ts` -- Entity name extraction + 1-hop graph expansion
- `src/retrieval/reranker.ts` -- RRF combination + trust-weighted scoring
- `src/retrieval/query-classifier.ts` -- Local vs global query routing + task-type boosts
- `src/retrieval/vector-search.ts` -- ONNX embedder + cosine similarity (VSS fallback)
- `src/retrieval/search.ts` -- Three-stage pipeline orchestration

### Files to modify:
- `src/mcp/tools/sia-search.ts` -- Wire three-stage pipeline, preserve workspace routing
- `src/mcp/server.ts` -- Fix task_type enum (add "bug-fix" alongside "regression")

### Test files to create:
- `tests/unit/retrieval/bm25-search.test.ts`
- `tests/unit/retrieval/graph-traversal.test.ts`
- `tests/unit/retrieval/reranker.test.ts`
- `tests/unit/retrieval/query-classifier.test.ts`
- `tests/unit/retrieval/search.test.ts`

---

## Task 1: BM25 Keyword Search

**Files:**
- Replace: `src/retrieval/bm25-search.ts`
- Create: `tests/unit/retrieval/bm25-search.test.ts`

**Context:** FTS5 `MATCH` query against `entities_fts` virtual table (already set up in graph.db schema with sync triggers). Normalized rank gives 0-1 range. Filters by `t_valid_until IS NULL`. Supports multi-term, phrase, and `package_path` filter. FTS5 rank is negative (lower = better) so we negate and normalize.

**Reference:** ARCHI section 5.1, TASKS 7.1

- [ ] **Step 1: Implement bm25-search.ts**

Export `bm25Search(db, query, opts?)` returning `BM25Result[]` where `BM25Result = { entityId: string; score: number }`.

Key implementation:
- `sanitizeFts5Query(query)` -- preserve quoted phrases, strip FTS5 special chars
- SQL: JOIN `entities_fts` with `entities` on rowid, MATCH query, apply bi-temporal filter (`t_valid_until IS NULL`, `archived_at IS NULL`), optional `package_path` and `paranoid` filters
- Normalize `-fts.rank` to 0-1 range using min/max of result set
- Return empty array for empty/invalid queries

- [ ] **Step 2: Write BM25 tests**

7 tests using `openGraphDb` + `insertEntity` + `afterEach` cleanup:
1. Exact entity name returns as top result
2. Multi-term query ranks all-term matches higher
3. package_path filter scopes to package
4. Invalidated entities excluded
5. Paranoid mode excludes Tier 4
6. Empty query returns empty
7. Quoted phrase search works

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run tests/unit/retrieval/bm25-search.test.ts
git add src/retrieval/bm25-search.ts tests/unit/retrieval/bm25-search.test.ts
git commit -m "feat(retrieval): implement BM25 keyword search via FTS5"
```

---

## Task 2: Graph Traversal Search Signal

**Files:**
- Replace: `src/retrieval/graph-traversal.ts`
- Create: `tests/unit/retrieval/graph-traversal.test.ts`

**Context:** Extract entity names from query string. Direct lookup against entities table. Traverse 1 hop via active edges. Root entity = 1.0, neighbor = 0.7.

**Reference:** ARCHI section 5.1, TASKS 7.2

- [ ] **Step 1: Implement graph-traversal.ts**

Export `graphTraversalSearch(db, query, opts?)` returning `GraphTraversalResult[]`.

Key implementation:
- `extractQueryTerms(query)` -- split on whitespace, try CamelCase splits, two-word combinations
- Direct lookup: `SELECT id FROM entities WHERE name = ? AND t_valid_until IS NULL`
- Also try LIKE match for partial names (min 3 chars)
- 1-hop expansion via `edges` table (active only)
- Deduplicate: Map keyed by entityId, highest score wins
- Sort by score DESC, cap at limit

- [ ] **Step 2: Write graph traversal tests**

5 tests:
1. Known entity name returns at score 1.0
2. Neighbors appear at score 0.7
3. No duplicate IDs
4. Unknown query returns empty
5. Invalidated entities excluded

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run tests/unit/retrieval/graph-traversal.test.ts
git add src/retrieval/graph-traversal.ts tests/unit/retrieval/graph-traversal.test.ts
git commit -m "feat(retrieval): implement graph traversal search signal"
```

---

## Task 3: Query Classifier + Task-Type Boosting

**Files:**
- Replace: `src/retrieval/query-classifier.ts`
- Create: `tests/unit/retrieval/query-classifier.test.ts`

**Context:** Keyword-based classification. Broad queries -> global (community summaries). Specific queries -> local (three-stage). Global never invoked below 100 entities. Task-type boost vectors and package-path boost defined here.

**Reference:** ARCHI section 5.4, TASKS 7.4, 7.6

- [ ] **Step 1: Implement query-classifier.ts**

Exports:
- `classifyQuery(db, query, config)` returning `ClassificationResult = { mode: "local"|"global", globalUnavailable: boolean }`
- `TASK_TYPE_BOOSTS: Record<string, Set<string>>` -- maps task types to boosted entity types
- `packagePathBoost(entityPkg, activePkg): number` -- returns 0.15 for match, 0 otherwise

Classification logic:
- GLOBAL_KEYWORDS: "architecture", "overview", "explain", "structure", "high-level", "design", "modules"
- LOCAL_KEYWORDS: "function", "class", "method", "bug", "fix", "implement", "where is", "how does"
- Count keyword matches, default to local if tied
- Force local if graph < 100 entities (set `globalUnavailable: true`)

Task-type boosts per ARCHI:
- "bug-fix" / "regression" -> Bug, Solution
- "feature" -> Concept, Decision
- "review" -> Convention

- [ ] **Step 2: Write classifier tests**

6 tests:
1. "explain the architecture" -> global
2. "how does TokenStore.validate work" -> local
3. Graph < 100 entities -> local with globalUnavailable: true
4. Ambiguous query defaults to local
5. TASK_TYPE_BOOSTS maps correctly
6. packagePathBoost returns 0.15/0

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run tests/unit/retrieval/query-classifier.test.ts
git add src/retrieval/query-classifier.ts tests/unit/retrieval/query-classifier.test.ts
git commit -m "feat(retrieval): implement query classifier and task-type boosting"
```

---

## Task 4: RRF Reranker with Trust Weighting

**Files:**
- Replace: `src/retrieval/reranker.ts`
- Create: `tests/unit/retrieval/reranker.test.ts`

**Context:** Combines three Stage 1 result lists via RRF (k=60). Applies trust weights (1->1.00, 2->0.90, 3->0.70, 4->0.50), importance, confidence, and task-type boost (matching types get 1.3x).

**Reference:** ARCHI section 5.1, TASKS 7.3

- [ ] **Step 1: Implement reranker.ts**

Exports:
- `rrfCombine(...lists: RankedCandidate[][]): Map<string, number>` -- RRF with k=60
- `rerank(db, rrfScores, opts): Promise<SiaSearchResult[]>` -- fetch entities, apply final scoring formula

Formula: `rrf_score * importance * confidence * trust_weight[tier] * (1 + task_boost * 0.3) + package_boost`

Trust weights map: `{ 1: 1.00, 2: 0.90, 3: 0.70, 4: 0.50 }` -- keyed by tier number, no index-0.

Import `TASK_TYPE_BOOSTS` and `packagePathBoost` from query-classifier.

Fetch entities in batches of 500 for large result sets.

- [ ] **Step 2: Write reranker tests**

6 tests:
1. Entity in all 3 lists ranks higher than entity in 1 list
2. Tier 1 entity scores higher than identical Tier 4
3. Paranoid mode excludes Tier 4
4. Bug-fix task type boosts Bug entities
5. Package-path boost: same-package ranks higher
6. Empty input returns empty

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run tests/unit/retrieval/reranker.test.ts
git add src/retrieval/reranker.ts tests/unit/retrieval/reranker.test.ts
git commit -m "feat(retrieval): implement RRF reranker with trust weighting"
```

---

## Task 5: Vector Search

**Files:**
- Replace: `src/retrieval/vector-search.ts`

**Context:** Embeds query via ONNX, searches via cosine similarity. Uses sqlite-vss when available, falls back to brute-force scan. No dedicated test file -- tested via integration in Task 6.

- [ ] **Step 1: Implement vector-search.ts**

Export `vectorSearch(db, query, embedder, opts?)` returning `VectorResult[]`.

Key implementation:
- Embed query via `embedder.embed(query)`
- Try sqlite-vss `vss_search` first via `rawSqlite()`
- Fallback: brute-force cosine scan on entities with embeddings (limit 1000 candidates)
- Filter by paranoid, packagePath
- `cosineSim(a, b)` internal helper

- [ ] **Step 2: Commit**

```bash
git add src/retrieval/vector-search.ts
git commit -m "feat(retrieval): implement vector similarity search with VSS fallback"
```

---

## Task 6: Three-Stage Pipeline Integration

**Files:**
- Replace: `src/retrieval/search.ts`
- Modify: `src/mcp/tools/sia-search.ts`
- Modify: `src/mcp/server.ts`
- Create: `tests/unit/retrieval/search.test.ts`

**Context:** Orchestrates all stages. Preserves workspace:true routing. Fixes task_type enum.

**Reference:** ARCHI section 5.1, TASKS 7.5

- [ ] **Step 1: Implement search.ts (three-stage orchestrator)**

Export `hybridSearch(db, embedder, opts): Promise<SearchResult>`.

Pipeline:
1. Classify query (local vs global)
2. If global: return community summaries
3. Stage 1: `Promise.all([bm25Search, graphTraversalSearch, vectorSearch])` -- parallel
4. Stage 2: `expandNeighbors` -- for each candidate, fetch 1-hop neighbors not already in set, add at score * 0.7
5. Stage 3: `rrfCombine` + `rerank`
6. Post-filter by `node_types` if specified
7. Add `extraction_method` if `includeProvenance`

- [ ] **Step 2: Fix task_type enum in server.ts**

Change `SiaSearchInput.task_type` to:
```typescript
task_type: z.enum(["orientation", "feature", "bug-fix", "regression", "review"]).optional(),
```

- [ ] **Step 3: Update sia-search.ts**

Replace the local-search SQL path (after the workspace check) with:
```typescript
import { hybridSearch } from "@/retrieval/search";

const searchResult = await hybridSearch(db, _embedder ?? null, {
  query: input.query,
  taskType: input.task_type,
  nodeTypes: input.node_types,
  packagePath: input.package_path,
  paranoid: input.paranoid,
  limit: effectiveLimit,
  includeProvenance: input.include_provenance,
});
return searchResult.results;
```

**CRITICAL:** Preserve the workspace routing block (lines 64-80) unchanged.

- [ ] **Step 4: Write integration tests**

6 tests:
1. BM25 match surfaces relevant entity
2. Graph traversal surfaces neighbors
3. Combined signals rank higher via RRF
4. Paranoid excludes Tier 4 across all stages
5. Global query returns community summaries
6. Existing workspace routing still works (existing sia-search tests pass)

- [ ] **Step 5: Run all retrieval + search tests**

```bash
npx vitest run tests/unit/retrieval/ tests/unit/mcp/tools/sia-search.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/retrieval/search.ts src/mcp/tools/sia-search.ts src/mcp/server.ts tests/unit/retrieval/search.test.ts
git commit -m "feat(retrieval): wire three-stage hybrid pipeline into sia-search"
```

---

## Task 7: Final Integration

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 2: Lint fix**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run lint:fix -- --unsafe
```

- [ ] **Step 3: Verify tests pass after lint**

```bash
npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: fix lint issues from phase 7"
```

---

## Execution Order

```
Task 1 (BM25) ──────────┐
Task 2 (graph traversal) ┼── parallel (independent modules)
Task 3 (classifier+boost)┤
Task 5 (vector search) ──┘
         |
Task 4 (RRF reranker) ─── depends on Tasks 1+2+3 (uses their types + boost exports)
         |
Task 6 (three-stage integration) ─── depends on all above
         |
Task 7 (final integration) ─── depends on all
```

**Optimal execution:** Tasks 1+2+3+5 in parallel -> Task 4 -> Task 6 -> Task 7
