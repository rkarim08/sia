# Codex Task: Phase 8 — Community Detection and RAPTOR Trees

## Setup

```bash
git fetch origin
git checkout -b phase-8/community v0.1.0-foundation
```

## Context

You are implementing community detection for Sia — a persistent graph memory system. The codebase already has: SiaDb adapter, entity/edge CRUD, graph.db schema (includes `communities`, `community_members`, `summary_tree` tables). All DB access through `SiaDb` interface.

**Tech stack:** Bun, TypeScript strict, Vitest, Biome. Use `PATH="$HOME/.bun/bin:$PATH"` before bun commands.

## What to Build

### Task 8.1 — Leiden Algorithm (`src/community/leiden.ts`) [BLOCKING]

Replace the stub. Export `detectCommunities(db: SiaDb, opts?: LeidenOpts): Promise<CommunityResult>`:

- Build an adjacency graph from active edges (`t_valid_until IS NULL`) in the graph
- Composite edge weights: structural edges (calls/imports/inherits_from) weight 0.5, co-occurrence weight 0.3, git co-change weight 0.2 (for now, use equal weights since we don't have co-change data yet)
- Implement a simplified Leiden/Louvain community detection:
  - Use modularity optimization: iteratively move nodes to the community that maximizes modularity gain
  - Three resolution parameters (2.0, 1.0, 0.5) for three hierarchy levels (fine=0, medium=1, coarse=2)
  - Run per-package first for monorepos, then whole-repo for higher levels
- Store results in `communities` and `community_members` tables
- Update `member_count` on each community after detection
- Return `CommunityResult: { levels: number[]; totalCommunities: number; durationMs: number }`

**Acceptance criteria:** 100+ entity graph produces at least 3 communities at level 1. Three levels with expected granularity. Only active edges used.

### Task 8.2 — Community Summary Generation (`src/community/summarize.ts`) [BLOCKING]

Replace the stub. Export `summarizeCommunities(db: SiaDb, config: { airGapped: boolean }): Promise<number>`:

- For each community without a summary (or with stale summary):
  - Get top-5 entities by importance within the community
  - Generate summary: concatenate entity names and summaries into a paragraph (simple text generation — real LLM summarization deferred)
  - Store in `communities.summary` field
  - Update `summary_hash` (SHA-256 of sorted member entity IDs)
  - Set `last_summary_member_count = member_count`
- Before regeneration: check if membership changed by >20% (`ABS(member_count - last_summary_member_count) / MAX(last_summary_member_count, 1) > 0.20`)
- When `airGapped=true`: skip summary generation entirely. Return cached summaries only. Do NOT update `last_summary_member_count`.
- Return count of summaries generated

**Acceptance criteria:** Summary is coherent text. Cache invalidation fires at >20% change. airGapped skips generation.

### Task 8.3 — Community Detection Scheduler (`src/community/scheduler.ts`)

Replace the stub. Export `shouldRunDetection(db: SiaDb, config: SiaConfig): Promise<boolean>` and `CommunityScheduler`:

- Fire when `new entities since last run > config.communityTriggerNodeCount (default 20)` AND total entities >= `config.communityMinGraphSize (default 100)`
- Track last run via a marker (e.g., most recent community `updated_at`)
- Return boolean indicating whether detection should run
- `CommunityScheduler` class: `{ check(): Promise<boolean>; run(db, config): Promise<void> }`

**Acceptance criteria:** Detection fires after threshold. Graphs below minimum produce false.

### Task 8.4 — RAPTOR Summary Tree (`src/community/raptor.ts`) [BLOCKING]

Replace the stub. Export `buildSummaryTree(db: SiaDb): Promise<void>`:

- Level 0: raw entity content (no generation — store reference in `summary_tree`)
- Level 1: per-entity one-paragraph summaries (lazy — generated on first access)
- Level 2: community/module summaries (from Task 8.2)
- Level 3: architectural overview (generated from Level 2 summaries)
- Store all in `summary_tree` table with content-hash invalidation
- When source entity is bi-temporally invalidated, mark its Level 1 summary `expires_at = now`

**Acceptance criteria:** Level 1 generated for entities. Invalidating an entity marks its summary expired.

### Task 8.5 — `npx sia community` CLI (`src/cli/commands/community.ts`)

Replace the stub. Print community structure: Level 2 at top, Level 1 indented, top-5 entities per community. Support `--package <path>` for monorepo scoping.

**Acceptance criteria:** Human-readable tree output. Handles "no communities yet" state.

## Tests

Create in `tests/unit/community/`:
- `leiden.test.ts` — test with a small graph (20+ entities with edges), verify communities detected
- `summarize.test.ts` — test summary generation, cache invalidation, airGapped mode
- `scheduler.test.ts` — test threshold logic
- `raptor.test.ts` — test summary tree levels, invalidation
- `community-cli.test.ts` — test CLI output

## Validation

```bash
bun run test:unit   # ALL tests must pass
bun run lint        # Clean
git push -u origin phase-8/community
```

## Important Notes

- Import `SiaDb` from `@/graph/db-interface`, entity CRUD from `@/graph/entities`
- Use `openGraphDb(repoHash, siaHome)` from `@/graph/semantic-db` for tests
- The `communities` and `community_members` tables are already in `migrations/semantic/001_initial.sql`
- Community entities have type 'Community' (this is a valid entity type in the schema)
- Do NOT add Co-Authored-By to commits
