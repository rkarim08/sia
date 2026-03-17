# Codex Task: Phase 11 — Decay, Lifecycle, and Flagging

## Setup

```bash
git fetch origin
git checkout -b phase-11/decay-lifecycle v0.1.0-foundation
```

## Context

You are implementing the decay/lifecycle system for Sia. The codebase has: entity/edge CRUD with bi-temporal invalidation, audit log, config with `decayHalfLife` settings, session flags CRUD, flag processor, consolidation pipeline. All DB access through `SiaDb`.

**Tech stack:** Bun, TypeScript strict, Vitest, Biome. Use `PATH="$HOME/.bun/bin:$PATH"` before bun commands.

## What to Build

### Task 11.1 — Importance Decay (`src/decay/decay.ts`) [BLOCKING]

Replace the stub. Export `decayImportance(db: SiaDb, config: SiaConfig): Promise<DecayResult>`:

- Iterate all non-archived, non-invalidated entities (`WHERE archived_at IS NULL AND t_valid_until IS NULL`)
- Apply exponential decay formula:
  ```
  daysSinceAccess = (Date.now() - last_accessed) / 86400000
  halfLife = config.decayHalfLife[entity.type] ?? config.decayHalfLife.default
  decayFactor = Math.pow(0.5, daysSinceAccess / halfLife)
  edgeBoost = Math.min(entity.edge_count * 0.02, 0.3)
  newImportance = Math.max(entity.base_importance * decayFactor + edgeBoost, 0.01)
  ```
- Highly-connected entities (edge_count > 20) never drop below 0.25
- Batch updates (500 at a time) via `updateEntity`
- Do NOT include bi-temporally invalidated entities in decay
- Return `DecayResult: { processed: number; durationMs: number }`

**Acceptance criteria:** Entity not accessed for 60 days drops ~50% from base_importance. High edge_count entity stays above 0.25. Batch completes under 30s for 50k entities. Invalidated entities excluded.

### Task 11.2 — Archival and Nightly Consolidation Sweep (`src/decay/archiver.ts`, `src/decay/consolidation-sweep.ts`)

Replace stubs.

**Archiver** (`src/decay/archiver.ts`): Export `archiveDecayedEntities(db: SiaDb, config: SiaConfig): Promise<number>`:
- Soft-archive entities where: `importance < config.archiveThreshold (0.05)` AND `edge_count = 0` AND not accessed in 90 days AND `t_valid_until IS NULL` (only archive active decayed entities, NOT invalidated ones)
- Use `archiveEntity` from `@/graph/entities` (sets `archived_at`, NOT `t_valid_until`)
- Return count archived

**Consolidation Sweep** (`src/decay/consolidation-sweep.ts`): Export `runConsolidationSweep(db: SiaDb): Promise<number>`:
- Find entity pairs NOT yet in `local_dedup_log` with same type and name similarity (Jaccard > 0.92 on content words)
- Use `wordJaccard` from `@/capture/consolidate`
- Run consolidation decision on each pair
- Write results to `local_dedup_log` (NOT `sync_dedup_log`)
- Return pairs processed

**Acceptance criteria:** Archived entities excluded from retrieval. Invalidated entities NOT archived. Sweep writes to `local_dedup_log`.

### Task 11.3 — Episodic-to-Semantic Promotion (`src/decay/episodic-promoter.ts`)

Replace the stub. Export `promoteFailedSessions(graphDb: SiaDb, episodicDb: SiaDb): Promise<number>`:

- Query `sessions_processed` for sessions with `processing_status = 'failed'`
- Also find sessions in `episodes` with no corresponding `sessions_processed` row (abrupt terminations)
- For each: re-extract from episode content using Track A + Track B
- Run through consolidation (handles dedup — no duplicate entities)
- Update `sessions_processed` to `'complete'`
- Return sessions promoted

**Acceptance criteria:** Failed sessions get re-extracted. Abrupt terminations detected. No duplicate entities.

### Task 11.4 — Flagging Enable/Disable CLI (`src/cli/commands/enable-flagging.ts`, `src/cli/commands/disable-flagging.ts`)

Replace stubs.

- `enable-flagging`: Set `enableFlagging: true` in config. Swap installed CLAUDE.md to flagging-enabled template (`src/agent/claude-md-template-flagging.md`). Idempotent.
- `disable-flagging`: Set `enableFlagging: false`. Swap back to base template (`src/agent/claude-md-template.md`). Idempotent.

**Acceptance criteria:** Enable adds sia_flag section. Disable removes it. Second enable is idempotent. Template-swap survives `npx sia install` re-run.

### Task 11.5 — `npx sia prune` and `npx sia stats` (`src/cli/commands/prune.ts`, `src/cli/commands/stats.ts`)

Replace stubs.

**Prune:**
- `prune --dry-run`: list all soft-archived entities (name, type, importance, days since access)
- `prune --confirm`: hard-DELETE archived entities and their edges from DB. Does NOT delete bi-temporally invalidated entities.

**Stats:**
- Print: total entities by type (active only), archived count, invalidated count, active edges by type, community count, episode count, storage sizes (file sizes of all .db files), last sync timestamp, pending conflict count

**Acceptance criteria:** Dry-run lists without deleting. Stats are accurate. Prune does NOT delete invalidated entities.

### Task 11.6 — Sharing Rules Enforcement (`src/capture/pipeline.ts` modification)

This is a small addition to the existing pipeline. After entity classification but before write:
- Query `sharing_rules` from meta.db for rules matching entity type and current workspace
- If a rule exists, override default `private` visibility with the rule's `default_visibility`
- Log auto-promotion to audit_log

**Acceptance criteria:** Decision entity in workspace with team sharing rule gets `visibility: 'team'`. Audit log records it.

### Task 11.7 — Nightly Scheduler (`src/decay/scheduler.ts`)

Replace the stub. Export `runNightlyJobs(config: SiaConfig, siaHome?: string): Promise<void>`:

- Run in order: importance decay → archival → consolidation sweep → episodic promotion
- Log each step's result
- Non-blocking — does not delay the capture pipeline

**Acceptance criteria:** All jobs run in sequence. Errors in one don't prevent others.

## Tests

Create in `tests/unit/decay/`:
- `decay.test.ts` — half-life formula, edge boost, floor, exclusions
- `archiver.test.ts` — archive threshold, 90-day access check, invalidated exclusion
- `consolidation-sweep.test.ts` — pair detection, local_dedup_log writes
- `episodic-promoter.test.ts` — failed session detection, re-extraction
- `scheduler.test.ts` — all jobs execute in order

Create in `tests/unit/cli/`:
- `flagging.test.ts` — enable/disable idempotency, template swap
- `prune.test.ts` — dry-run vs confirm, invalidated entities preserved
- `stats.test.ts` — accurate counts

## Validation

```bash
bun run test:unit   # ALL tests must pass
bun run lint        # Clean
git push -u origin phase-11/decay-lifecycle
```

## Important Notes

- `invalidateEntity` = fact was superseded (sets `t_valid_until` + `t_expired`) — NEVER use for decay
- `archiveEntity` = decayed to irrelevance (sets `archived_at` only) — use for decay
- `local_dedup_log` is for nightly sweeps; `sync_dedup_log` is for post-sync (has `peer_id`)
- `sharing_rules` table is in meta.db, NOT graph.db
- The `decayHalfLife` config supports: 'Decision' (90 days), 'Convention' (60), 'Bug' (45), 'Solution' (45), 'default' (30)
- Do NOT add Co-Authored-By to commits
