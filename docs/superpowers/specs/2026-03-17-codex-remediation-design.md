# Codex Phase Remediation — Design Spec

## Overview

Comprehensive remediation of Codex-generated Phases 6 (AST Backbone), 8 (Community Detection), and 10 (Team Sync) based on detailed code reviews that found 20 critical, 38 important, and 20 suggestion-level issues across the three phases.

**Execution order:** Phase 6 → Phase 8 → Phase 10 (dependency order — Phase 8's community detection depends on Phase 6's PageRank, Phase 10 is independent but lowest priority).

**Branches:** `phase-6/ast-remediation`, `phase-8/community-remediation`, `phase-10/sync-remediation`

**New shared dependency:** `@anthropic-ai/sdk` for Haiku LLM integration.

**New shared module:** `src/shared/llm-client.ts` — used by Phases 8 and 10.

---

## Shared: LLM Client

### File: `src/shared/llm-client.ts`

Interface:
```typescript
interface LlmClient {
  summarize(prompt: string): Promise<string>;
  classify(prompt: string, options: string[]): Promise<string>;
}
```

Factory: `createLlmClient(config: SiaConfig): LlmClient`
- Uses `@anthropic-ai/sdk` with model from `config.captureModel` (default: `claude-haiku-4-5-20251001`)
- Rate limiting: token bucket, max 10 requests/minute (configurable)
- When `config.airGapped === true` or `ANTHROPIC_API_KEY` is not set, returns a fallback client that uses heuristic string concatenation (so tests pass without an API key)
- All errors caught and logged — never throws to caller, returns fallback response instead

### SiaDb Interface Change

Add `sync?(): Promise<void>` to `SiaDb` interface. `BunSqliteDb` implements as no-op. `LibSqlDb` already has a `sync()` method — only the interface declaration and `BunSqliteDb` no-op need adding. This change is made once in Phase 10 Section 1 (not duplicated).

---

## Phase 6: AST Backbone Remediation

### Section 1: Indexer & Tier Dispatch

**Files modified:** `src/ast/indexer.ts`
**Files created:** `src/ast/extractors/sql-schema.ts`, `src/ast/extractors/prisma-schema.ts`, `src/ast/extractors/project-manifest.ts`

**Changes:**

1. **Tier dispatch in indexer** — After `getLanguageByExtension`, check `config.tier`:
   - Tier A/B: call `extractTrackA` (regex for now, Tree-sitter later when grammars installed)
   - Tier C: call `extractSchema(content, filePath, config.specialHandling)` — dispatches to sql-schema or prisma-schema based on `specialHandling` field
   - Tier D: call `extractManifest(content, filePath)` — extracts dependency edges from Cargo.toml/go.mod/pyproject.toml
   - Unknown extension: skip

2. **Deduplication on re-index** — Before `insertEntity`, query existing entities by `(name, file_paths)`. If found, call `updateEntity` with new content/summary. If not found, `insertEntity`. Matches how `handleChange` in the watcher already works.

3. **SQL schema extractor (`sql-schema.ts`)** — Regex-based extraction of `CREATE TABLE` statements, column definitions, foreign key constraints, and `CREATE INDEX` statements. Produces `CodeEntity` facts with type tags `["table"]`, `["column"]`, `["index"]`.

4. **Prisma schema extractor (`prisma-schema.ts`)** — Regex-based extraction of `model` blocks, field definitions, and `@relation` directives. Produces `CodeEntity` facts.

5. **Project manifest extractor (`project-manifest.ts`)** — Extracts dependency information from Cargo.toml `[workspace] members`, go.mod `replace` directives, and pyproject.toml `path =` dependencies. Reuses patterns from `src/workspace/api-contracts.ts`. Produces relationship edges rather than standalone entities.

6. **Tier A/B extractors remain as regex stubs** via `extractTrackA`. Tree-sitter grammar installation is out of scope. The dispatch wiring means adding Tree-sitter later is filling in a function body, not restructuring the pipeline.

### Section 2: Watcher Fixes

**Files modified:** `src/ast/watcher.ts`
**Files modified (tests):** `tests/unit/ast/watcher.test.ts`

**Changes:**

1. **`FileWatcher` interface** — Add `ready: Promise<void>` property and change `stop(): void` to `stop(): Promise<void>`. Eliminates `unknown` cast in tests, makes stop awaitable.

2. **Remove dual processing** — Delete the 200ms `setInterval` polling loop entirely. Use chokidar as sole event source. Keep the initial `syncOnce()` call on `start()` (handles files changed while watcher was stopped).

3. **Fix rename handler** — In `fs.watch` fallback: check `existsSync(absPath)` before calling `onChange`. If file doesn't exist, call `onDelete` directly. Don't rely on error propagation through nested try/catch.

4. **Update existing entity content** — In `handleChange`, when an entity name matches an existing one: compare content. If different, call `updateEntity` with new content/summary. Only skip if name AND content are identical.

5. **Remove unused `_rel` variable** — Line 121 dead code.

6. **New tests:**
   - Rename test: write file, rename, verify old entity invalidated + new entity created
   - Edge invalidation test: verify edges invalidated when relationships removed from file
   - Replace 700ms `setTimeout` with polling on condition (check entity count every 50ms, timeout at 5s) for CI reliability

### Section 3: PageRank & Path Utils

**Files modified:** `src/ast/pagerank-builder.ts`, `src/ast/path-utils.ts`
**Files modified (tests):** `tests/unit/ast/pagerank.test.ts`

**Changes:**

1. **O(n) adjacency construction** — Replace `[...(outgoing.get(id) ?? []), newId]` array spread with `Map<string, string[]>` using `push` on existing arrays.

2. **Fixed teleport vector** — When `activeFileIds` is non-empty, give non-active nodes weight `0.01 / totalNodes` instead of zero. Prevents dangling nodes from converging to zero importance.

3. **Batched entity updates** — Replace `Promise.all(nodeList.map(update))` with `db.executeMany()` chunked in batches of 500.

4. **Convergence return value** — Return `{ iterations: number, converged: boolean, finalDelta: number }` from `computePageRank`. Log warning if not converged.

5. **Gitignore negation patterns** — Track `!`-prefixed patterns in a separate `negated` set. After matching against ignore patterns, check if file matches any negation pattern; if so, un-ignore it.

6. **Gitignore directory-only patterns** — When pattern ends with `/`, only match directories (append `/**` to generated regex).

7. **New tests:**
   - Empty graph test (computePageRank returns early)
   - Invalidated edges exclusion test (create invalidated edge, verify excluded from PageRank)
   - Convergence metrics assertion

### Section 4: Reindex CLI & Test Gaps

**Files modified:** `src/cli/commands/reindex.ts`
**Files modified (tests):** `tests/unit/ast/indexer.test.ts`, `tests/unit/ast/reindex.test.ts`

**Changes:**

1. **Monorepo re-detection** — Before `indexRepository`, call `detectMonorepoPackages` + `registerMonorepoPackages` from `src/workspace/detector.ts`.

2. **API contract re-detection** — Call `detectApiContracts` + `writeDetectedContracts` from `src/workspace/api-contracts.ts`.

3. **Progress reporting** — Replace flat `console.log` with `[N/total] Indexing path/to/file.ts...` format. Add `(dry-run)` prefix when `--dry-run` active.

4. **New tests for indexer.test.ts:**
   - `.gitignore` exclusion test
   - `onProgress` callback test
   - Missing `.git` directory error test

5. **New test for reindex.test.ts:**
   - Missing `.git` directory error path

---

## Phase 8: Community Detection Remediation

### Section 1: LLM-Powered Summaries

**Files modified:** `src/community/summarize.ts`
**Dependencies:** `src/shared/llm-client.ts` (shared module)

**Changes:**

1. **Replace `formatSummary` string concatenation** with LLM call via `LlmClient.summarize()`. Prompt includes top-5 entity names and summaries, asks for a coherent paragraph describing the community's purpose. **Air-gapped behavior (per ARCHI Task 8.2):** when `airGapped=true`, skip summary generation entirely — return existing cached summaries unchanged and do NOT update `last_summary_member_count` (preventing false 'up to date' signal). The current code already handles this correctly; preserve that behavior.

2. **Fix empty case message** — Return `"Community has no active members (all entities invalidated or archived)."` instead of the misleading `"Community has no active members."`.

3. **Accept `LlmClient` as parameter** — `summarizeCommunities(db, llmClient)` so the caller controls the client instance and testability.

### Section 2: RAPTOR & Leiden

**Files modified:** `src/community/raptor.ts`, `src/community/leiden.ts`

**Files also modified:** `src/mcp/tools/sia-expand.ts` (wire lazy Level 1 generation)

**RAPTOR changes:**

1. **Level 0 active-only query** — Add `WHERE t_valid_until IS NULL AND archived_at IS NULL` to the entity query.

2. **Level 1 lazy generation** — Remove eager Level 1 loop from `buildSummaryTree`. Add `getOrCreateLevel1Summary(db, entityId, llmClient)` function in `raptor.ts`. Wire into `src/mcp/tools/sia-expand.ts` — when expanding an entity, call `getOrCreateLevel1Summary` before returning results.

3. **Level 2 via LLM** — `buildSummaryTree` generates Level 2 eagerly using `LlmClient.summarize()` with community member summaries as context.

4. **Level 3 weekly scheduling** — Add `lastLevel3At` timestamp tracking. Only regenerate Level 3 if more than 7 days have passed since last generation.

**Leiden changes:**

5. **Refinement step** — Add `refinePartition(community: Map<string, string>, adj: Map<string, Map<string, number>>): Map<string, string>` function after each Louvain pass. Algorithm: for each community, run BFS/DFS on the subgraph of its members using the adjacency list. If the community has multiple disconnected components, assign each component a new unique community ID (e.g., `${originalId}_${componentIndex}`). Return the refined partition map. This is the essential Leiden improvement — it prevents the "poorly connected communities" problem where Louvain merges nodes that have no path between them within the community.

6. **Per-package detection** — For monorepos, query entities grouped by `package_path`. Run detection per-package at Level 0, then merge all entities for Level 1 and Level 2 passes.

7. **Edge type weight fixes** — Add `contains: 0.5`, `depends_on: 0.5` to `EDGE_TYPE_WEIGHTS`. Change default fallthrough from `1.0` to `0.3`.

8. **Iteration cap** — Add `maxIterations = 100` guard on `while (moved)` loop.

### Section 3: Scheduler, CLI & Tests

**Files modified:** `src/community/scheduler.ts`, `src/cli/commands/community.ts`
**Files modified (tests):** All 5 test files in `tests/unit/community/`

**Scheduler:**
1. Add `console.warn` for graphs below minimum size.
2. Add `runInBackground(): void` method that fire-and-forgets `this.run()` with error logging.

**CLI:**
3. Add Level 0 community display — indented under Level 1 parent, showing name and member count.
4. Fix `--package` filter — remove `OR package_path IS NULL` when package specified.

**Tests — all 5 files:**
5. Add `afterEach` cleanup blocks (db.close + rmSync).
6. **leiden.test.ts** — Verify intra-cluster entities assigned to same Level 0 community. Verify 3 clusters produce 3 distinct communities.
7. **community-cli.test.ts** — Verify output contains Level 2 heading, indented Level 1, Level 0 notes. Verify `--package` scoping.
8. **summarize.test.ts** — Add 20% boundary test (exactly 20% should NOT trigger, 21% should).
9. **scheduler.test.ts** — Test `CommunityScheduler.check()` and `.run()` methods.
10. **raptor.test.ts** — Content-hash invalidation test (change entity content, verify Level 1 regenerated).

---

## Phase 10: Team Sync Remediation

### Section 1: HLC & Core Infrastructure

**Files modified:** `src/sync/hlc.ts`, `src/sync/client.ts`, `src/sync/keychain.ts`, `src/graph/db-interface.ts`
**Files modified (tests):** `tests/unit/sync/helpers.ts`, `tests/unit/sync/hlc.test.ts`, `tests/unit/sync/keychain.test.ts`

**Changes:**

1. **HLC type rewrite** — Change from `{ wallMs, counter, nodeId }` struct to plain `bigint` per ARCHI section 9.1. `hlcNow(local: bigint): bigint` returns new bigint. `hlcReceive(local: bigint, remote: bigint): bigint` returns merged bigint. Remove all mutation. Breaking change — consumers in `push.ts`, `pull.ts`, `team.ts`, and `hlc.test.ts` must be updated.

2. **HLC persistence** — Match ARCHI signatures: `persistHlc(repoHash: string, hlc: bigint)` resolves path internally to `{siaHome}/repos/{repoHash}/hlc.json`. `loadHlc(repoHash: string): bigint` reads it back. Encapsulates file path convention. Falls back to `pack(Date.now(), 0)` on missing/corrupt file.

3. **`createSiaDb` verification** — The current `createSiaDb` in `src/sync/client.ts` already throws when sync is disabled, matching ARCHI section 9.3. However, the code review found it silently falls back to `openDb` — verify the current behavior and fix only if it actually falls back. If it already throws correctly, mark as no-op.

4. **Keychain dedup** — Extract constructor probe into `getKeychainEntry(serverUrl)` helper. Add `console.warn` when falling through to file storage.

5. **SiaDb interface** — Add `sync?(): Promise<void>`. No-op in `BunSqliteDb`, real sync in `LibSqlDb`.

6. **Test schema** — Replace `helpers.ts` custom schema with `openGraphDb(repoHash, tmpDir)` using real migrations.

7. **Test cleanup** — Add `afterEach` to `hlc.test.ts`, `keychain.test.ts`. Restore `process.env.HOME` in keychain test cleanup.

### Section 2: Push & Pull

**Files modified:** `src/sync/push.ts`, `src/sync/pull.ts`
**Files modified (tests):** `tests/unit/sync/push.test.ts`, `tests/unit/sync/pull.test.ts`

**Push changes:**

1. **Push edges** — After entity push, query edges where both endpoints are in pushed entity set. Update `synced_at`. Chunk queries in batches of 500.

2. **Push bridge edges** — Accept `bridgeDb: SiaDb` parameter. Query `cross_repo_edges` where both repos have team-visible entities.

3. **HLC for synced_at** — Use `hlcNow(loadHlc(hlcPath))` instead of `Date.now()`. Persist updated HLC after push.

**Pull changes:**

4. **Consolidation** — Pass received entities through `consolidate(db, candidates)` from Phase 4. Track which entity IDs were inserted/updated.

5. **Pull bridge edges** — Use `bridgeDb` parameter. Apply bi-temporal merge on remote bridge edges.

6. **Update sync_peers** — Upsert sender's peer ID, display name, last HLC, current timestamp.

7. **Persist HLC** — Load from disk, call `hlcReceive`, persist back.

8. **Scoped VSS refresh** — Only refresh VSS for entity IDs that were actually inserted/updated during consolidation, not full table.

9. **VSS uses rawSqlite()** — Use `rawSqlite()` directly for VSS INSERT. Fall back to skip with warning if null (LibSqlDb).

**New tests:**
- Push: edge pushing test, idempotent re-push test
- Pull: consolidation verification, sync_peers update, HLC persistence

### Section 3: Conflict Detection & Dedup

**Files modified:** `src/sync/conflict.ts`, `src/sync/dedup.ts`
**Files modified (tests):** `tests/unit/sync/conflict.test.ts`, `tests/unit/sync/dedup.test.ts`

**Conflict changes:**

1. **Cosine similarity** — Replace `wordJaccard` with `cosineSimilarity` on embeddings. Threshold 0.85. Entities without embeddings fall back to wordJaccard > 0.95.

2. **LLM-classified contradictions** — Replace `content !==` with `LlmClient.classify()` prompt: "Are these two facts contradictory, complementary, or duplicates?" Air-gapped fallback: `content !==`.

3. **Performance** — Pre-filter by entity type (already done) + skip pairs where embedding magnitude difference > 0.3.

**Dedup changes:**

4. **Layer 3 Haiku resolution** — For 0.80-0.92 cosine pairs, call `LlmClient.classify()` with options `["SAME", "DIFFERENT", "RELATED"]`. SAME → merge, DIFFERENT → leave, RELATED → `relates_to` edge.

5. **Merge implementation** — Union tags arrays, union file_paths arrays, LLM-synthesized merged description, keep higher trust_tier, record `merged_from` metadata, `invalidateEntity` on losing entity.

6. **RELATED edge creation** — `insertEdge` with `type: "relates_to"`, `weight: 0.6`.

7. **Importance recalculation** — Recency-weighted average: `sum(score_i * e^(-0.01 * age_days_i)) / sum(e^(-0.01 * age_days_i))`.

8. **Fix `normalizeName`** — Change regex to preserve hyphens and underscores: `[^a-z0-9\-_]`.

**New tests:**
- Conflict: non-overlapping time range test, semantically unrelated test, threshold boundary
- Dedup: Layer 2 with embeddings test, 0.80-0.92 flagging test, merge verification

### Section 4: CLI Commands & Tests

**Files modified:** `src/cli/commands/server.ts`, `src/cli/commands/share.ts`, `src/cli/commands/team.ts`, `src/cli/commands/conflicts.ts`
**Files modified (tests):** `tests/unit/sync/client.test.ts`

**Server CLI (full rewrite):**

1. **`start`** — Generate 32-byte hex JWT secret, write to `~/.sia/server/.env` (NOT docker-compose.yml — per ARCHI Task 10.9, secrets stay out of compose files). Write `docker-compose.yml` from template (sqld image, port 8080, `env_file: .env`). Run `docker compose up -d` via `execFile`, print URL. Store state in `~/.sia/server.json`.

2. **`stop`** — Run `docker compose down` via `execFile`.

3. **`status`** — Read `server.json`, check Docker container status, query `sync_peers` count, query synced entity count.

**Share fix:**
4. Call `resolveWorkspaceName(metaDb, opts.project)` to convert name to UUID before storing. Throw if not found. Call `pushChanges` after update for immediate push.

**Team fixes:**
5. **leave** — Add `synced_at = NULL` to UPDATE.
6. **status** — Query `sync_peers` count, `entities WHERE conflict_group_id IS NOT NULL AND t_valid_until IS NULL` for conflicts, `last_sync_at` from `sync_config`.

**Conflicts fix:**
7. Add `t_valid_until IS NULL` filter to `listConflicts`. Validate `keepEntityId` belongs to `groupId` in `resolveConflict`.

**Test fixes:**
8. `client.test.ts` — Assert `syncInterval` passthrough to `createClient` mock.
9. All sync test files — afterEach cleanup with rmSync.

---

## Acceptance Criteria

### Phase 6
- Indexer dispatches by language tier (A/B → regex, C → schema extractor, D → manifest extractor)
- Re-indexing updates existing entities instead of creating duplicates
- Watcher uses chokidar only (no polling), `stop()` is awaitable, rename handled correctly
- PageRank runs in O(n) adjacency time, returns convergence metrics
- All existing + new tests pass
- Lint clean on Phase 6 files

### Phase 8
- Community summaries are LLM-generated coherent paragraphs (air-gapped: skip generation, return cached)
- RAPTOR Level 0 is active-only, Level 1 is lazy (generated on first sia_expand), Level 3 is weekly
- Leiden has refinement step, per-package detection, iteration cap
- All 5 test files have afterEach cleanup
- All existing + new tests pass

### Phase 10
- HLC is bigint type matching ARCHI spec
- Push sends entities + edges + bridge edges
- Pull runs consolidation pipeline, updates sync_peers, persists HLC
- Conflict detection uses cosine similarity with LLM classification
- Dedup Layer 3 uses Haiku for SAME/DIFFERENT/RELATED classification
- Merge creates synthesized description, unions tags/file_paths, records merged_from
- Server CLI manages Docker sqld container
- All test files use real migration schema via openGraphDb
- All existing + new tests pass

---

## Traceability Matrix — Critical Issues

Maps each critical finding from the code reviews to its remediation item in this spec.

### Phase 6 Critical (5)
| # | Finding | Remediation |
|---|---------|-------------|
| C1 | Indexer: no dispatch to tier-specific extractors | Phase 6, Section 1, item 1 (tier dispatch) |
| C2 | Indexer: no deduplication on re-index | Phase 6, Section 1, item 2 (dedup) |
| C3 | Watcher: `FileWatcher` interface missing `ready` | Phase 6, Section 2, item 1 |
| C4 | Watcher: `fs.watch` rename handler dead code | Phase 6, Section 2, item 3 |
| C5 | Watcher: `stop()` fire-and-forget | Phase 6, Section 2, item 1 (awaitable stop) |

### Phase 8 Critical (1)
| # | Finding | Remediation |
|---|---------|-------------|
| C1 | RAPTOR Level 0 loads ALL entities incl. invalidated | Phase 8, Section 2, RAPTOR item 1 |

### Phase 10 Critical (14)
| # | Finding | Remediation |
|---|---------|-------------|
| C1 | HLC type is mutable struct, not bigint | Phase 10, Section 1, item 1 |
| C2 | `hlcReceive` returns void, not bigint | Phase 10, Section 1, item 1 |
| C3 | `createSiaDb` falls back to openDb | Phase 10, Section 1, item 3 (verify) |
| C4 | Push: edges never pushed | Phase 10, Section 2, item 1 |
| C5 | Push: bridge cross_repo_edges never pushed | Phase 10, Section 2, item 2 |
| C6 | Pull: no consolidation pipeline | Phase 10, Section 2, item 4 |
| C7 | Pull: bridgeDb unused, bridge edges not pulled | Phase 10, Section 2, item 5 |
| C8 | Pull: sync_peers never updated | Phase 10, Section 2, item 6 |
| C9 | Pull: HLC never persisted | Phase 10, Section 2, item 7 |
| C10 | Conflict: wordJaccard instead of cosine similarity | Phase 10, Section 3, item 1 |
| C11 | Dedup: Layer 3 (Haiku) missing | Phase 10, Section 3, item 4 |
| C12 | Dedup: merge not implemented | Phase 10, Section 3, item 5 |
| C13 | Server CLI: entire stub | Phase 10, Section 4, items 1-3 |
| C14 | Share: doesn't resolve workspace name to UUID | Phase 10, Section 4, item 4 |

## Traceability Matrix — Important Issues

### Phase 6 Important (11)
| # | Finding | Remediation |
|---|---------|-------------|
| I1 | All 6 extractor files empty stubs | Phase 6, Section 1, items 3-5 (C/D extractors); A/B remain regex with dispatch wired |
| I2 | Watcher: polling runs alongside chokidar | Phase 6, Section 2, item 2 |
| I3 | Watcher: handleChange never updates content | Phase 6, Section 2, item 4 |
| I4 | PageRank: O(n^2) adjacency via spread | Phase 6, Section 3, item 1 |
| I5 | PageRank: teleport zero for non-active nodes | Phase 6, Section 3, item 2 |
| I6 | PageRank: Promise.all N updates | Phase 6, Section 3, item 3 |
| I7 | path-utils: gitignore negation not handled | Phase 6, Section 3, item 5 |
| I8 | path-utils: gitignore dir-only patterns | Phase 6, Section 3, item 6 |
| I9 | reindex: no contract/monorepo re-detection | Phase 6, Section 4, items 1-2 |
| I10 | Watcher: unused _rel variable | Phase 6, Section 2, item 5 |
| I11 | Watcher tests: 700ms timing flaky | Phase 6, Section 2, item 6 (tests) |

### Phase 8 Important (12)
| # | Finding | Remediation |
|---|---------|-------------|
| I1 | Leiden: no per-package detection | Phase 8, Section 2, item 6 |
| I2 | summarize: no LLM call, string concat stub | Phase 8, Section 1, item 1 |
| I3 | summarize: sort by importance not PageRank | Verified correct (PageRank writes to importance column) — no change |
| I4 | RAPTOR: Level 1 eager not lazy | Phase 8, Section 2, item 2 |
| I5 | RAPTOR: Level 3 not weekly | Phase 8, Section 2, item 4 |
| I6 | RAPTOR: Level 1 not LLM-generated | Phase 8, Section 2, item 2 (uses LlmClient) |
| I7 | scheduler: no log warning for small graphs | Phase 8, Section 3, item 1 |
| I8 | CLI: Level 0 not shown | Phase 8, Section 3, item 3 |
| I9 | CLI: top-5 by importance not PageRank | Same as I3 — verified correct |
| I10-I14 | All 5 test files missing afterEach | Phase 8, Section 3, item 5 |
| I11 | leiden.test assertions too weak | Phase 8, Section 3, item 6 |
| I12 | community-cli.test assertions too weak | Phase 8, Section 3, item 7 |

### Phase 10 Important (15)
| # | Finding | Remediation |
|---|---------|-------------|
| I1 | keychain: constructor logic 3x duplicated | Phase 10, Section 1, item 4 |
| I2 | keychain: silent fallthrough to file | Phase 10, Section 1, item 4 (add warn) |
| I3 | push: unsafe type assertion for sync() | Phase 10, Section 2, item 10 (SiaDb interface) |
| I4 | pull: VSS refreshes ALL embeddings | Phase 10, Section 2, item 8 |
| I5 | pull: VSS uses db.execute not rawSqlite | Phase 10, Section 2, item 9 |
| I6 | conflict: contradictory is just content!== | Phase 10, Section 3, item 2 |
| I7 | conflict: O(n^2) full scan | Phase 10, Section 3, item 3 |
| I8 | dedup: RELATED edge missing | Phase 10, Section 3, item 6 |
| I9 | dedup: importance recalc missing | Phase 10, Section 3, item 7 |
| I10 | team leave: doesn't clear synced_at | Phase 10, Section 4, item 5 |
| I11 | team status: missing peer/conflict counts | Phase 10, Section 4, item 6 |
| I12 | share: no immediate push | Phase 10, Section 4, item 4 |
| I13 | helpers.ts: incomplete schema (15 vs 33 cols) | Phase 10, Section 1, item 6 |
| I14 | helpers.ts: doesn't use openGraphDb | Phase 10, Section 1, item 6 |
| I15 | client.test: doesn't verify syncInterval | Phase 10, Section 4, item 8 |
