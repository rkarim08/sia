# Phase 10: Team Sync Remediation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 14 critical and 15 important bugs in the Codex-generated Phase 10 team sync code — HLC type rewrite to bigint, push edges+bridge, pull with consolidation+peers+HLC persistence, conflict cosine similarity with LLM, dedup Layer 3 with merge, server CLI with Docker, and CLI fixes.

**Architecture:** HLC becomes a plain bigint (pack/unpack as internal helpers). Push/pull gain edge and bridge.db support. Conflict detection switches from wordJaccard to cosine similarity with LLM classification. Dedup gets full merge implementation. All test files switch from custom schemas to `openGraphDb` with real migrations.

**Tech Stack:** Bun, TypeScript strict, SiaDb adapter, `@anthropic-ai/sdk` (via shared LlmClient), Vitest with better-sqlite3 shim, Biome 2.x

**Branch:** `phase-10/sync-remediation`

**Important:** Do NOT add Co-Authored-By to commit messages. Run tests via `npx vitest run` (not `bun run test`) due to better-sqlite3 compatibility.

---

## File Structure

### Files to modify:
- `src/sync/hlc.ts` — Rewrite HLC to bigint type
- `src/sync/push.ts` — Add edge+bridge pushing, HLC timestamps
- `src/sync/pull.ts` — Add consolidation, sync_peers, HLC persist, scoped VSS
- `src/sync/conflict.ts` — Cosine similarity + LLM classification
- `src/sync/dedup.ts` — Layer 3 Haiku, merge implementation, RELATED edges, importance recalc
- `src/sync/keychain.ts` — Deduplicate constructor probe logic
- `src/sync/client.ts` — Verify createSiaDb behavior
- `src/graph/db-interface.ts` — Add sync() to SiaDb interface
- `src/cli/commands/server.ts` — Full rewrite with Docker
- `src/cli/commands/share.ts` — Workspace name resolution + push
- `src/cli/commands/team.ts` — Fix leave synced_at, status peer/conflict counts
- `src/cli/commands/conflicts.ts` — Add t_valid_until filter, validate keepEntityId
- `tests/unit/sync/helpers.ts` — Replace with openGraphDb
- `tests/unit/sync/hlc.test.ts` — Update for bigint, add afterEach
- `tests/unit/sync/push.test.ts` — Add edge test, use real schema
- `tests/unit/sync/pull.test.ts` — Add consolidation test, use real schema
- `tests/unit/sync/conflict.test.ts` — Add threshold/similarity tests
- `tests/unit/sync/dedup.test.ts` — Add Layer 2/3 tests
- `tests/unit/sync/keychain.test.ts` — Add afterEach
- `tests/unit/sync/client.test.ts` — Assert syncInterval

---

## Task 1: HLC Bigint Rewrite + SiaDb Interface

**Files:**
- Modify: `src/sync/hlc.ts`
- Modify: `src/graph/db-interface.ts`
- Modify: `tests/unit/sync/hlc.test.ts`

**Context:** HLC type changes from mutable struct to plain bigint. All consumers must be updated. SiaDb gets sync() method on the interface.

- [ ] **Step 1: Rewrite hlc.ts to use bigint**

Replace the entire module. Key changes:
- `export type HLC = bigint` (not a struct)
- `hlcNow(local: bigint): bigint` — returns new bigint, no mutation
- `hlcReceive(local: bigint, remote: bigint): bigint` — returns merged bigint
- `persistHlc(repoHash: string, hlc: bigint, siaHome?: string)` — resolves to `{siaHome}/repos/{repoHash}/hlc.json`, writes decimal string
- `loadHlc(repoHash: string, siaHome?: string): bigint` — reads back, falls back to `pack(Date.now(), 0)` on error
- Keep `pack`, `unpack`, `hlcFromDb` as before (internal helpers)

- [ ] **Step 2: Add sync() to SiaDb interface**

In `src/graph/db-interface.ts`, add to the `SiaDb` interface:
```typescript
sync?(): Promise<void>;
```
Add to `BunSqliteDb`:
```typescript
async sync(): Promise<void> {
  // No-op for local-only mode
}
```
`LibSqlDb` already has `sync()` — no change needed there.

- [ ] **Step 3: Update hlc tests**

Rewrite `tests/unit/sync/hlc.test.ts`:
- Use `openGraphDb` pattern (not needed for HLC but add afterEach for tmpDir)
- Test `hlcNow` returns bigint, is monotonically increasing
- Test `hlcReceive` returns bigint > both inputs
- Test `persistHlc`/`loadHlc` round-trip with repoHash
- Test `hlcFromDb` with null, number, string, bigint inputs

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/sync/hlc.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/sync/hlc.ts src/graph/db-interface.ts tests/unit/sync/hlc.test.ts
git commit -m "feat(sync): rewrite HLC to bigint type, add sync() to SiaDb interface"
```

---

## Task 2: Test Infrastructure + Keychain Fix

**Files:**
- Modify: `tests/unit/sync/helpers.ts`
- Modify: `src/sync/keychain.ts`
- Modify: `tests/unit/sync/keychain.test.ts`
- Modify: `src/sync/client.ts`
- Modify: `tests/unit/sync/client.test.ts`

**Context:** Replace custom test schema with openGraphDb. Deduplicate keychain constructor probe. Verify createSiaDb behavior.

- [ ] **Step 1: Replace helpers.ts with openGraphDb**

Replace `tests/unit/sync/helpers.ts`:
```typescript
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

export function createTestDb(tmpDir?: string): { db: SiaDb; tmpDir: string; repoHash: string } {
  const dir = tmpDir ?? join(tmpdir(), `sia-sync-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const repoHash = `test-${randomUUID().slice(0, 8)}`;
  const db = openGraphDb(repoHash, dir);
  return { db, tmpDir: dir, repoHash };
}
```
This gives the full 33-column schema via real migrations.

- [ ] **Step 2: Deduplicate keychain constructor probe**

In `src/sync/keychain.ts`, extract the 4-line constructor probe into a helper:
```typescript
type KeychainEntry = { setPassword(pw: string): Promise<void>; getPassword(): Promise<string | null>; deletePassword(): Promise<void> };

async function getKeychainEntry(serverUrl: string): Promise<KeychainEntry | null> {
  const keyring = await getKeyring();
  if (!keyring) return null;

  const EntryCtor =
    (keyring as any).Entry ??
    (keyring as any).default?.Entry ??
    (keyring as any).Keyring ??
    (keyring as any).default;

  if (!EntryCtor) return null;

  try {
    return new EntryCtor(SERVICE_NAME, serverUrl) as KeychainEntry;
  } catch {
    return null;
  }
}
```
Then simplify `storeToken`, `getToken`, `deleteToken` to use it. Add `console.warn("OS keychain unavailable — falling back to file storage")` when falling through.

- [ ] **Step 3: Verify createSiaDb**

Check `src/sync/client.ts` — if it falls back to `openDb` when sync disabled, change to throw per ARCHI spec. If it already throws, leave as-is.

Current code: `if (!config.enabled || !config.serverUrl) { return openDb(repoHash, opts); }` — this DOES fall back. Fix:
```typescript
if (!config.enabled || !config.serverUrl) {
  throw new Error("createSiaDb() called without sync enabled. Use openSiaDb() instead.");
}
```

- [ ] **Step 4: Fix client.test.ts**

Update the test that expects `openDb` fallback to instead expect a thrown error. Add `syncInterval` passthrough assertion.

- [ ] **Step 5: Fix keychain.test.ts afterEach**

Add `afterEach` to restore `process.env.HOME` and clean tmpDir.

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/unit/sync/
```

- [ ] **Step 7: Commit**

```bash
git add tests/unit/sync/helpers.ts src/sync/keychain.ts tests/unit/sync/keychain.test.ts src/sync/client.ts tests/unit/sync/client.test.ts
git commit -m "fix(sync): test schema via openGraphDb, keychain dedup, createSiaDb throws"
```

---

## Task 3: Push + Pull Fixes

**Files:**
- Modify: `src/sync/push.ts`
- Modify: `src/sync/pull.ts`
- Modify: `tests/unit/sync/push.test.ts`
- Modify: `tests/unit/sync/pull.test.ts`

**Context:** Push adds edge+bridge support. Pull adds consolidation, sync_peers, HLC persistence, scoped VSS.

- [ ] **Step 1: Fix push — add edges and bridge**

Update `pushChanges` signature to accept `bridgeDb`:
```typescript
export async function pushChanges(
  db: SiaDb,
  config: SyncConfig,
  bridgeDb?: SiaDb,
  repoHash?: string,
  siaHome?: string,
): Promise<PushResult>
```

After pushing entities, push edges:
- Query edges where both `from_id` AND `to_id` are in the pushed entity set
- Batch UPDATE `synced_at` in chunks of 500
- Count pushed edges

Push bridge edges (if `bridgeDb` provided):
- Query `cross_repo_edges` where both repo IDs have team-visible entities
- Similar batched update

Use `hlcNow(loadHlc(repoHash, siaHome))` for `synced_at` instead of `Date.now()`. Persist updated HLC after push.

Replace unsafe `db.sync()` cast with `await db.sync?.()` (works since SiaDb interface now has optional sync).

- [ ] **Step 2: Fix pull — consolidation, peers, HLC**

Update `pullChanges`:
- After syncing, get received entities (query for non-private with hlc_modified > synced_at)
- Pass each through `consolidate(db, candidates)` from `@/capture/consolidate`
- Track inserted/updated entity IDs
- Update `sync_peers` table with sender peer info
- Load HLC from disk, call `hlcReceive` with max remote HLC, persist back
- Scoped VSS refresh: only refresh for entity IDs that were actually processed
- Use `rawSqlite()` directly for VSS INSERT, skip with warning if null

- [ ] **Step 3: Update push tests**

Use `createTestDb()` from updated helpers. Add:
- Edge pushing test: create entities + edge, push, verify edge synced_at set
- Idempotent re-push test: push twice, verify no duplicates

- [ ] **Step 4: Update pull tests**

Use `createTestDb()`. Add:
- Consolidation verification: insert entity, pull, verify audit entry for SYNC_RECV
- sync_peers update test (if sync_peers table exists in schema)
- HLC persistence test: verify hlc.json exists after pull

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/unit/sync/push.test.ts tests/unit/sync/pull.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/sync/push.ts src/sync/pull.ts tests/unit/sync/push.test.ts tests/unit/sync/pull.test.ts
git commit -m "fix(sync): push edges+bridge, pull with consolidation+peers+HLC"
```

---

## Task 4: Conflict + Dedup Fixes

**Files:**
- Modify: `src/sync/conflict.ts`
- Modify: `src/sync/dedup.ts`
- Modify: `tests/unit/sync/conflict.test.ts`
- Modify: `tests/unit/sync/dedup.test.ts`

**Context:** Conflict switches to cosine similarity with LLM. Dedup gets Layer 3, merge, RELATED edges, importance recalc.

- [ ] **Step 1: Fix conflict detection**

Replace `wordJaccard` with cosine similarity:
```typescript
import { cosineSimilarity } from "@/sync/dedup"; // or extract to shared
import type { LlmClient } from "@/shared/llm-client";

export async function detectConflicts(db: SiaDb, llmClient?: LlmClient): Promise<number>
```

For each entity pair:
- If both have embeddings: use `cosineSimilarity > 0.85`
- If either lacks embeddings: fall back to `wordJaccard > 0.95`
- For contradiction check: if `llmClient`, call `llmClient.classify()` with prompt asking "contradictory, complementary, or duplicate". If air-gapped, fall back to `content !==`.
- Pre-filter: skip pairs where embedding magnitude difference > 0.3

- [ ] **Step 2: Fix dedup — Layer 3, merge, RELATED**

Add `llmClient` parameter to `deduplicateEntities`.

For pairs in 0.80-0.92 range (currently `"pending"`):
- Call `llmClient.classify(prompt, ["SAME", "DIFFERENT", "RELATED"])`
- SAME → merge, DIFFERENT → leave, RELATED → create `relates_to` edge

Merge implementation:
- Union `tags` JSON arrays
- Union `file_paths` JSON arrays
- If `llmClient`: synthesize merged description via `llmClient.summarize()`
- Keep higher `trust_tier`
- Record `merged_from: [a.id, b.id]` in surviving entity metadata (store in content as JSON prefix or new field)
- Call `invalidateEntity` on the losing entity

RELATED: `insertEdge(db, { from_id: a.id, to_id: b.id, type: "relates_to", weight: 0.6 })`

Importance recalculation:
```typescript
const ageDaysA = (now - a.created_at) / 86400000;
const ageDaysB = (now - b.created_at) / 86400000;
const wA = Math.exp(-0.01 * ageDaysA);
const wB = Math.exp(-0.01 * ageDaysB);
const newImportance = (a.importance * wA + b.importance * wB) / (wA + wB);
```

Fix `normalizeName`: change regex to `[^a-z0-9\-_]+` to preserve hyphens and underscores.

- [ ] **Step 3: Export cosineSimilarity**

Move or export `cosineSimilarity` from `dedup.ts` so `conflict.ts` can use it.

- [ ] **Step 4: Update conflict tests**

Use `createTestDb()`. Add:
- Non-overlapping time range: verify NOT flagged
- Different types: verify NOT flagged (already exists but needs real schema)
- Threshold boundary: entities with cosine ~0.84 should NOT be flagged, ~0.86 should

- [ ] **Step 5: Update dedup tests**

Use `createTestDb()`. Add:
- Layer 2 test with mock embeddings (high cosine → merged)
- 0.80-0.92 range flagging test
- Merge verification: after merge, check surviving entity has unioned tags

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/unit/sync/conflict.test.ts tests/unit/sync/dedup.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/sync/conflict.ts src/sync/dedup.ts tests/unit/sync/conflict.test.ts tests/unit/sync/dedup.test.ts
git commit -m "fix(sync): cosine similarity conflicts, dedup Layer 3 + merge + RELATED"
```

---

## Task 5: CLI Fixes

**Files:**
- Modify: `src/cli/commands/server.ts`
- Modify: `src/cli/commands/share.ts`
- Modify: `src/cli/commands/team.ts`
- Modify: `src/cli/commands/conflicts.ts`

**Context:** Server CLI rewrite with Docker. Share resolves workspace name. Team leave clears synced_at. Team status shows peers/conflicts.

- [ ] **Step 1: Rewrite server.ts**

Full implementation:
```typescript
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SIA_HOME } from "@/shared/config";

const SERVER_DIR = join(SIA_HOME, "server");
const CONFIG_PATH = join(SERVER_DIR, "server.json");
const ENV_PATH = join(SERVER_DIR, ".env");
const COMPOSE_PATH = join(SERVER_DIR, "docker-compose.yml");
```

- `serverStart()`: Generate JWT secret → write `.env` → write `docker-compose.yml` (with `env_file: .env`) → `execFileSync("docker", ["compose", "up", "-d"])` → write `server.json` with URL
- `serverStop()`: `execFileSync("docker", ["compose", "down"])` → update `server.json`
- `serverStatus()`: Read `server.json`, try `docker compose ps`, return running state + URL

- [ ] **Step 2: Fix share.ts**

Add workspace name resolution:
```typescript
import { openMetaDb, resolveWorkspaceName } from "@/graph/meta-db";
import { pushChanges } from "@/sync/push";

export async function shareEntity(
  db: SiaDb,
  entityId: string,
  opts: { team?: boolean; project?: string | null; siaHome?: string; syncConfig?: SyncConfig } = {},
): Promise<void> {
  let workspaceScope: string | null = null;
  if (opts.project) {
    const metaDb = openMetaDb(opts.siaHome);
    try {
      const wsId = await resolveWorkspaceName(metaDb, opts.project);
      if (!wsId) throw new Error(`Workspace '${opts.project}' not found`);
      workspaceScope = wsId;
    } finally {
      await metaDb.close();
    }
  }

  const visibility = opts.team ? "team" : opts.project ? "project" : "private";
  await updateEntity(db, entityId, { visibility, workspace_scope: workspaceScope });

  // Trigger immediate push
  if (opts.syncConfig?.enabled) {
    await pushChanges(db, opts.syncConfig);
  }
}
```

- [ ] **Step 3: Fix team.ts**

`teamLeave`: Add `synced_at = NULL` to the UPDATE:
```typescript
await opts.db.execute(
  "UPDATE entities SET visibility = 'private', workspace_scope = NULL, synced_at = NULL"
);
```

`teamStatus`: Query actual data:
```typescript
export async function teamStatus(opts: { siaHome?: string; db?: SiaDb } = {}): Promise<TeamStatus> {
  const config = getConfig(opts.siaHome);
  let peerCount = 0;
  let pendingConflicts = 0;
  let lastSyncAt: number | null = null;

  if (opts.db) {
    const peers = await opts.db.execute("SELECT COUNT(*) as cnt FROM sync_peers");
    peerCount = (peers.rows[0]?.cnt as number) ?? 0;

    const conflicts = await opts.db.execute(
      "SELECT COUNT(DISTINCT conflict_group_id) as cnt FROM entities WHERE conflict_group_id IS NOT NULL AND t_valid_until IS NULL"
    );
    pendingConflicts = (conflicts.rows[0]?.cnt as number) ?? 0;

    // Note: sync_peers doesn't exist in graph.db schema, it's in meta.db
    // For now, query from the provided db (may need metaDb parameter later)
  }

  return {
    enabled: config.sync.enabled,
    serverUrl: config.sync.serverUrl,
    developerId: config.sync.developerId,
    syncInterval: config.sync.syncInterval,
    peerCount,
    pendingConflicts,
    lastSyncAt,
  };
}
```

- [ ] **Step 4: Fix conflicts.ts**

Add `t_valid_until IS NULL` to `listConflicts`:
```typescript
"SELECT conflict_group_id, id FROM entities WHERE conflict_group_id IS NOT NULL AND archived_at IS NULL AND t_valid_until IS NULL"
```

Add validation in `resolveConflict`:
```typescript
const keepRow = await db.execute(
  "SELECT id FROM entities WHERE id = ? AND conflict_group_id = ?",
  [keepEntityId, groupId],
);
if (keepRow.rows.length === 0) {
  throw new Error(`Entity '${keepEntityId}' not found in conflict group '${groupId}'`);
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/unit/sync/
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/server.ts src/cli/commands/share.ts src/cli/commands/team.ts src/cli/commands/conflicts.ts
git commit -m "fix(sync): server CLI with Docker, share workspace resolution, team/conflicts fixes"
```

---

## Task 6: Final Integration

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 2: Run linter**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run lint:fix -- --unsafe
```

- [ ] **Step 3: Verify tests still pass after lint**

```bash
npx vitest run
```

- [ ] **Step 4: Commit lint fixes if needed**

```bash
git add -A && git commit -m "chore: fix lint issues from phase 10 remediation"
```

---

## Execution Order

```
Task 1 (HLC + SiaDb) ─── foundational, everything depends on bigint HLC
         │
Task 2 (test infra + keychain + client) ─── foundational for all test files
         │
Task 3 (push + pull) ──┐
Task 4 (conflict + dedup) ──┼── parallel (different files)
Task 5 (CLI fixes) ────────┘
         │
Task 6 (integration) ─── depends on all above
```

**Optimal execution:** Task 1 → Task 2 → Tasks 3+4+5 in parallel → Task 6
