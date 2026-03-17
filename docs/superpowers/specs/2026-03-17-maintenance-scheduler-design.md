# Maintenance Scheduler — Design Spec

## Overview

Replace the "nightly batch" maintenance model across Sia with a startup-catchup + idle-opportunistic model. Instead of a cron-style scheduled job, maintenance runs when opportunity arises: on startup if overdue, during idle gaps in active sessions, and as a focused sweep on session end.

**Affected phases:** Phase 11 (Decay, Lifecycle, Flagging), Phase 12 references, README.md, ARCHITECTURE.md, plans/SIA_TASKS.md, plans/SIA_ARCHI.md.

---

## Core Architecture

### Maintenance Scheduler (`src/decay/maintenance-scheduler.ts`)

Central orchestrator with three trigger modes:

**1. Startup Catchup**
- Fires on MCP server init or SessionStart hook
- Reads `~/.sia/repos/<hash>/maintenance.json` for `lastSweepAt`
- If `Date.now() - lastSweepAt > config.maintenanceInterval` (default 24h), queues a full sweep
- Sweep runs in background via yielding between batches — never blocks first query
- Processes all 5 work units in priority order, 50-node batches each

**2. Idle Opportunistic**
- Tracks timestamp of last `PostToolUse` event
- When gap exceeds `config.idleTimeoutMs` (default 60s), runs ONE batch from highest-priority work unit that has remaining work
- When new `PostToolUse` fires, maintenance pauses immediately (checked via `paused` flag at top of each batch iteration)
- Deep validation LLM calls rate-limited to 1 per `config.deepValidationRateMs` (default 5s)

**3. Session-End Sweep**
- Fires on SessionEnd hook
- Targeted sweep of current session's entities only (`source_episode = sessionId`)
- Deduplicates session output against existing graph content
- Typically < 2 seconds for a session's worth of nodes (5-20 entities)

### State File

`~/.sia/repos/<hash>/maintenance.json` — sidecar JSON, same pattern as `centroid.json` and `hlc.json`:
```json
{
  "lastSweepAt": 1710000000000,
  "lastSessionSweepAt": 1710000000000,
  "pendingBatchOffset": 0
}
```

### Scheduler Interface

```typescript
interface MaintenanceScheduler {
  onStartup(repoHash: string): Promise<void>;
  onPostToolUse(): void;
  onSessionEnd(sessionId: string): Promise<void>;
  stop(): void;
}
```

---

## Work Units

Each work unit processes a small batch and returns whether more work remains:

```typescript
interface BatchResult {
  processed: number;
  remaining: boolean;
}
```

Five work units in priority order:

| Priority | Unit | File | Batch Size | Description |
|----------|------|------|------------|-------------|
| 1 | Decay | `src/decay/decay.ts` | 50 | Apply ARCHI §8.1 importance decay formula, ordered by `last_accessed ASC` |
| 2 | Archival | `src/decay/archiver.ts` | 50 | Soft-archive: `importance < threshold AND edge_count = 0 AND 90 days idle AND t_valid_until IS NULL` |
| 3 | Consolidation sweep | `src/decay/consolidation-sweep.ts` | 50 pairs | Find entity pairs NOT in `local_dedup_log` with cosine > 0.92, same type. Write to `local_dedup_log` |
| 4 | Episodic promotion | `src/decay/episodic-promoter.ts` | 1 session | Re-process failed/missing sessions from `sessions_processed` |
| 5 | Deep validation | `src/decay/deep-validator.ts` | 1 entity | LLM re-verification of lowest-confidence Tier 3 entity. Rate-limited to 1 call per 5s |
| 6 | Bridge orphan cleanup | `src/decay/bridge-orphan-cleanup.ts` | 50 edges | Invalidate `cross_repo_edges` where source/target entity no longer active. ATTACHes peer graph.db files (max 8) |

**FTS5 optimization** runs once per full sweep completion (not per batch):
```sql
INSERT INTO entities_fts(entities_fts) VALUES('optimize')
```

### Adaptive Batch Sizing

Startup catchup uses larger batches (500 nodes) since it runs to completion anyway — smaller batches would just add yield overhead. Idle processing uses smaller batches (50 nodes) for responsiveness. The batch size is passed to each work unit, not hardcoded.

### Startup Catchup Flow

All 6 units run in sequence. For each unit: run batches (size 500) until `remaining === false`, yielding (`await new Promise(r => setTimeout(r, 0))`) between batches so the event loop can service queries.

### Idle Processing Flow

Run ONE batch (size 50) from the highest-priority unit that has `remaining === true`. Then yield back. Next idle cycle picks up where it left off.

### Session-End Flow

Dedicated `sweepSession(db, sessionId)`:
1. Query entities where `source_episode = sessionId`
2. For each, check `local_dedup_log` for existing pairs
3. Run consolidation against existing graph (same-type, cosine > 0.92)
4. Write results to `local_dedup_log`

---

## Integration Points

### Hook Wiring

The scheduler is instantiated alongside the MCP server and receives hook events:

- `SessionStart` → `scheduler.onStartup(repoHash)` — triggers catchup check
- `PostToolUse` → `scheduler.onPostToolUse()` — resets idle timer
- `SessionEnd` → `scheduler.onSessionEnd(sessionId)` — triggers session sweep

### Config Additions

Three new fields in `SiaConfig` (in `src/shared/config.ts`):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maintenanceInterval` | `number` | `86400000` (24h) | Time threshold for startup catchup |
| `idleTimeoutMs` | `number` | `60000` (60s) | Gap before idle maintenance starts |
| `deepValidationRateMs` | `number` | `5000` (5s) | Minimum gap between LLM validation calls |

---

## Documentation Updates

### ARCHITECTURE.md

Replace all "nightly" references in:
- Module 7 (Decay & Lifecycle Engine) — change "nightly decay job" to "maintenance sweep (startup catchup + idle opportunistic)"
- Section 8.2 (Nightly Consolidation Sweep) — rename to "Consolidation Sweep" and describe the new trigger model
- WAL atomicity note — change "nightly consolidation sweep" to "maintenance sweep"
- Freshness engine references — update "nightly background job" to "background maintenance (startup catchup or idle processing)"

### README.md

- Update freshness engine section — replace "nightly background job" with startup-catchup + idle model description
- Update config reference — add `maintenanceInterval`, `idleTimeoutMs`, `deepValidationRateMs`
- Remove any "cron" or "2am" language
- Update the maintenance model description to explain the three trigger modes

### plans/SIA_TASKS.md

- Phase 11 goal: change "Nightly decay" to "Opportunistic maintenance"
- Task 11.1: change "nightly job" to "maintenance sweep batch" throughout
- Task 11.2: change "nightly consolidation sweep" to "consolidation sweep batch"
- Task 11.3: change "next nightly run" to "next maintenance sweep"
- Task 11.7: change "nightly scheduler slot" to "maintenance sweep"
- Phase 12: update any references

### plans/SIA_ARCHI.md

- §8.1: describe maintenance scheduler trigger model instead of "nightly"
- §8.2: rename "Nightly Consolidation Sweep" and describe batch + idle model
- §8.3: change "Queries ... for session IDs" context from nightly to maintenance sweep

---

## What This Replaces

The old model:
- "Nightly job at 2am" → impossible in a CLI tool with no daemon
- All maintenance in one big synchronous batch → blocks everything
- No maintenance between sessions → graph decays unevenly

The new model:
- "Nightly" = time threshold (24h default), not a schedule
- Work broken into 50-node batches with yielding
- Three opportunities: startup, idle gaps, session end
- Maintenance always runs — the question is when the opportunity arises

---

## File Structure

### New files:
- `src/decay/maintenance-scheduler.ts` — central orchestrator
- `src/decay/session-sweeper.ts` — session-end focused dedup
- `src/decay/deep-validator.ts` — LLM re-verification work unit
- `tests/unit/decay/maintenance-scheduler.test.ts`
- `tests/unit/decay/session-sweeper.test.ts`

### Existing stubs to replace (with batch interface):
- `src/decay/decay.ts` — importance decay batch
- `src/decay/archiver.ts` — soft-archival batch
- `src/decay/consolidation-sweep.ts` — dedup sweep batch
- `src/decay/episodic-promoter.ts` — session re-processing batch
- `src/decay/scheduler.ts` — DELETE (replaced by maintenance-scheduler.ts)

### Existing stub to replace (new in Phase 11):
- `src/decay/bridge-orphan-cleanup.ts` — bridge edge orphan invalidation batch (currently no stub — create new)

### Files to modify:
- `src/shared/config.ts` — add 3 new config fields
- `ARCHITECTURE.md` — replace nightly references
- `README.md` — replace nightly references
- `plans/SIA_TASKS.md` — update Phase 11 and 12 descriptions
- `plans/SIA_ARCHI.md` — update §8 (Decay & Lifecycle)
