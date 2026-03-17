# Codex Task: Phase 10 — Team Sync

## Setup

```bash
git fetch origin
git checkout -b phase-10/team-sync v0.1.0-foundation
```

## Context

You are implementing team sync for Sia. The codebase has: SiaDb adapter with `BunSqliteDb` (local) and a stubbed `LibSqlDb` (for `@libsql/client`), entity/edge CRUD, all 4 database schemas, config loading with `SyncConfig`. Team sync uses `@libsql/client` embedded replicas to sync with a self-hosted `sqld` server.

**Tech stack:** Bun, TypeScript strict, Vitest, Biome. Use `PATH="$HOME/.bun/bin:$PATH"` before bun commands.

**Install dependencies:** `bun add @libsql/client @napi-rs/keyring`

## What to Build

### Task 10.1 — HLC Integration (`src/sync/hlc.ts`) [BLOCKING]

Replace the stub. Implement Hybrid Logical Clock:

- Export `HLC` type: `{ wallMs: number; counter: number; nodeId: string }`
- Export `hlcNow(local: HLC): bigint` — returns packed HLC as BigInt (wallMs << 16 | counter)
- Export `hlcReceive(local: HLC, remote: bigint): void` — merges remote HLC into local
- Export `hlcFromDb(value: unknown): bigint` — safely converts DB column to BigInt (null → 0n)
- Export `persistHlc(hlc: HLC, filePath: string): void` — write to JSON file (decimal string encoding)
- Export `loadHlc(filePath: string, nodeId: string): HLC` — read from file or create new
- HLC monotonically increases within a process
- Persist across restarts via `~/.sia/repos/{hash}/hlc.json`

**Acceptance criteria:** HLC increases monotonically. Persists across simulated restarts. `hlcFromDb(null)` returns `0n`.

### Task 10.2 — OS Keychain Integration (`src/sync/keychain.ts`) [BLOCKING]

Replace the stub. Uses `@napi-rs/keyring`:

- Export `storeToken(serverUrl: string, token: string): Promise<void>`
- Export `getToken(serverUrl: string): Promise<string | null>`
- Export `deleteToken(serverUrl: string): Promise<void>`
- Service name: `"sia-sync"`, account: `serverUrl`

**Acceptance criteria:** Token stored and retrieved. `getToken` returns null for unknown URL. Token NEVER stored in config.json.

Note: If `@napi-rs/keyring` doesn't work in the test environment, create a fallback file-based store at `~/.sia/.tokens` with appropriate file permissions (0600) and test with that.

### Task 10.3 — SiaDb Factory with LibSQL (`src/sync/client.ts`) [BLOCKING]

Replace the stub. Export `createSiaDb(repoHash: string, config: SyncConfig): Promise<SiaDb>`:

- Read auth token from keychain via `getToken(config.serverUrl)`
- If no token found: throw clear error "Run 'npx sia team join' to authenticate"
- Create `@libsql/client` embedded replica with `syncInterval` from config
- Return `LibSqlDb` wrapping the client
- Also implement the full `LibSqlDb` class in `src/graph/db-interface.ts` (currently it's referenced but not fully implemented for Phase 10)

**Acceptance criteria:** `sync.enabled=false` → BunSqliteDb. `sync.enabled=true` → LibSqlDb with correct syncInterval. Missing token → descriptive error.

### Task 10.4 — Push Layer (`src/sync/push.ts`)

Replace the stub. Export `pushChanges(db: SiaDb, config: SyncConfig): Promise<PushResult>`:

- Query entities where `visibility != 'private' AND (synced_at IS NULL OR synced_at < hlc_modified)`
- Push via `client.sync()` (libSQL embedded replica sync)
- Mark pushed entities with `synced_at = Date.now()`
- Also push qualifying `bridge.cross_repo_edges`
- Write `SYNC_SEND` audit log entries
- Return `PushResult: { entitiesPushed: number; edgesPushed: number }`

**Acceptance criteria:** Only non-private entities pushed. `synced_at` updated. Idempotent.

### Task 10.5 — Pull Layer (`src/sync/pull.ts`)

Replace the stub. Export `pullChanges(db: SiaDb, bridgeDb: SiaDb, config: SyncConfig): Promise<PullResult>`:

- Fetch changeset since `last_sync_at` HLC
- Run received entities through consolidation pipeline
- Update local HLC via `hlcReceive`
- Update `sync_peers` with sender info
- Post-sync VSS refresh: for entities with `embedding IS NOT NULL`, insert into `entities_vss` (if rawSqlite available)
- Write `SYNC_RECV` and `VSS_REFRESH` audit log entries
- Return `PullResult: { entitiesReceived: number; edgesReceived: number; vssRefreshed: number }`

**Acceptance criteria:** Received entities go through consolidation (not blindly overwritten). VSS refresh works.

### Task 10.6 — Conflict Detection (`src/sync/conflict.ts`)

Replace the stub. Export `detectConflicts(db: SiaDb): Promise<number>`:

- After pull: find entity pairs with same type, overlapping valid-time windows, cosine similarity > 0.85, but contradictory content
- Assign shared `conflict_group_id` UUID to both entities
- Do NOT auto-resolve
- Return number of conflicts detected

**Acceptance criteria:** Contradictory concurrent facts get same `conflict_group_id`. Non-contradictory not flagged.

### Task 10.7 — Three-Layer Deduplication (`src/sync/dedup.ts`)

Replace the stub. Export `deduplicateEntities(db: SiaDb, peerEntities: Entity[]): Promise<DedupeResult>`:

- Layer 1: deterministic name normalization + Jaccard > 0.95 → auto-merge
- Layer 2: if embedding available, cosine similarity > 0.92 → auto-merge; 0.80-0.92 → flag for Layer 3
- Layer 3: for now, just flag as 'pending' (real LLM resolution deferred)
- Write results to `sync_dedup_log` (NOT `local_dedup_log`)
- Return `DedupeResult: { merged: number; flagged: number; different: number }`

**Acceptance criteria:** Same concept from two devs merges at Layer 1/2. Results in `sync_dedup_log` with `peer_id`.

### Task 10.8 — Team Sync CLI (`src/cli/commands/team.ts`, `src/cli/commands/share.ts`, `src/cli/commands/conflicts.ts`, `src/cli/commands/server.ts`)

Replace stubs:
- `team join <server-url> <token>` — store token, write sync_config, initial pull
- `team leave` — disable sync, delete token, reset visibility
- `team status` — print sync info
- `share <entity-id> [--team | --project <workspace>]` — promote visibility
- `conflicts list` / `conflicts resolve <group-id> --keep <entity-id>` — list/resolve conflicts
- `server start/stop/status` — Docker compose management for sqld

**Acceptance criteria:** `team join` triggers initial pull. `team leave` resets state. `conflicts resolve` calls `invalidateEntity`.

## Tests

Create in `tests/unit/sync/`:
- `hlc.test.ts` — monotonicity, persist/load, hlcFromDb
- `keychain.test.ts` — store/get/delete token round-trip
- `client.test.ts` — factory routing (sync disabled vs enabled)
- `push.test.ts` — only non-private pushed, synced_at updated
- `pull.test.ts` — consolidation applied, VSS refresh
- `conflict.test.ts` — detection logic
- `dedup.test.ts` — three-layer dedup

## Validation

```bash
bun run test:unit   # ALL tests must pass
bun run lint        # Clean
git push -u origin phase-10/team-sync
```

## Important Notes

- The `sync_dedup_log` table has a `peer_id` column; `local_dedup_log` does NOT
- `entities.visibility` field: 'private' (default), 'team', 'project'
- HLC values stored as INTEGER but read back as BigInt via `hlcFromDb()`
- Auth tokens go in OS keychain, NEVER in config.json
- `invalidateEntity` sets `t_valid_until` + `t_expired`; `archiveEntity` sets `archived_at` — different operations
- Do NOT add Co-Authored-By to commits
