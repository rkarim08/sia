# Session 2 — SiaDb Adapter + Migration Runner

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the SiaDb unified database adapter (Task 1.13) and migration runner (Task 1.2) so that all four Sia databases can be opened, migrated, and operated through a single type-safe interface.

**Architecture:** `SiaDb` is an async interface wrapping `bun:sqlite` (local) and `@libsql/client` (sync mode) behind one contract. `BunSqliteDb` is the primary implementation for Phase 1. `LibSqlDb` is stubbed with the interface only (full impl in Phase 10). The migration runner reads numbered `.sql` files from a directory, applies each exactly once via a `_migrations` table, sets WAL/NORMAL/FK pragmas, and returns a `BunSqliteDb`. All CRUD code in later tasks writes against `SiaDb`, never raw `bun:sqlite`.

**Tech Stack:** Bun 1.x, TypeScript strict, bun:sqlite, Vitest

**Branch:** `phase-1/storage-foundation`

---

## File Map

**Modify:**
- `src/graph/db-interface.ts` — SiaDb interface, BunSqliteDb, openDb, openSiaDb
- `src/graph/semantic-db.ts` — Migration runner (runMigrations, openGraphDb, openEpisodicDb)
- `src/graph/meta-db.ts` — openMetaDb (uses migration runner)
- `src/graph/bridge-db.ts` — openBridgeDb (uses migration runner)
- `src/shared/config.ts` — SIA_HOME constant and SyncConfig type (minimal, just what is needed)

**Test:**
- `tests/unit/graph/db-interface.test.ts` — SiaDb adapter tests
- `tests/unit/graph/migration-runner.test.ts` — Migration runner tests
- `tests/unit/graph/open-db.test.ts` — openDb factory tests
- `tests/unit/graph/db-openers.test.ts` — Database opener helper tests

---

## Task 1: SiaDb Interface and BunSqliteDb

**Files:**
- Modify: `src/graph/db-interface.ts`
- Create: `tests/unit/graph/db-interface.test.ts`

- [ ] **Step 1: Write failing tests for BunSqliteDb**

Create `tests/unit/graph/db-interface.test.ts` with tests for:
- execute INSERT and SELECT
- execute SELECT with no params
- executeMany runs multiple statements
- transaction commits on success
- transaction rolls back on error
- nested transaction throws
- rawSqlite returns the underlying Database

All tests create a `:memory:` Database, wrap in `BunSqliteDb`, test operations on a simple `test` table.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:unit -- tests/unit/graph/db-interface.test.ts`
Expected: FAIL (BunSqliteDb not exported from stub)

- [ ] **Step 3: Implement SiaDb interface and BunSqliteDb**

Replace `src/graph/db-interface.ts` stub with:
- `SiaDb` interface: `execute`, `executeMany`, `transaction`, `close`, `rawSqlite`
- `BunSqliteDb` class implementing `SiaDb` wrapping `bun:sqlite` Database
- Transaction uses explicit BEGIN/COMMIT/ROLLBACK (not db.transaction) to support async callbacks
- Transaction proxy prevents nested transactions with clear error message
- execute distinguishes read (SELECT/PRAGMA) from write statements

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:unit -- tests/unit/graph/db-interface.test.ts`
Expected: all 7 tests PASS

- [ ] **Step 5: Lint and commit**

Run: `bun run lint:fix -- --unsafe`

Commit:
```
feat(graph): implement SiaDb interface and BunSqliteDb adapter
```

---

## Task 2: SyncConfig Type + openDb Factory + openSiaDb Router

**Files:**
- Modify: `src/shared/config.ts`
- Modify: `src/graph/db-interface.ts`
- Create: `tests/unit/graph/open-db.test.ts`

- [ ] **Step 1: Add SyncConfig type to shared/config.ts**

Replace stub with:
- `SIA_HOME` constant (`~/.sia`)
- `SyncConfig` interface (enabled, serverUrl, developerId, syncInterval)
- `DEFAULT_SYNC_CONFIG` (all disabled/null defaults)

- [ ] **Step 2: Write failing tests for openDb and openSiaDb**

Create `tests/unit/graph/open-db.test.ts` with tests for:
- creates and opens a database file in test directory
- sets WAL mode on writable connection
- sets foreign_keys ON
- does NOT crash on readonly connection
- openSiaDb returns BunSqliteDb when sync disabled
- openSiaDb returns BunSqliteDb when sync enabled but no serverUrl

All tests use a temp directory cleaned up in afterEach.

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test:unit -- tests/unit/graph/open-db.test.ts`
Expected: FAIL (openDb not exported)

- [ ] **Step 4: Add openDb and openSiaDb to db-interface.ts**

Add to `src/graph/db-interface.ts`:
- `OpenDbOpts` interface (readonly, siaHome override for testing)
- `openDb(repoHash, opts)` — creates dir, opens bun:sqlite Database, sets WAL/NORMAL/FK pragmas (skip for readonly), returns BunSqliteDb
- `openSiaDb(repoHash, syncConfig, opts)` — routes to openDb when sync disabled, dynamic imports createSiaDb when sync enabled

- [ ] **Step 5: Run tests**

Run: `bun run test:unit -- tests/unit/graph/open-db.test.ts`
Expected: all tests PASS

- [ ] **Step 6: Lint and commit**

Commit:
```
feat(graph): add openDb factory and openSiaDb router
```

---

## Task 3: Migration Runner

**Files:**
- Modify: `src/graph/semantic-db.ts`
- Create: `tests/unit/graph/migration-runner.test.ts`

- [ ] **Step 1: Write failing tests for migration runner**

Create `tests/unit/graph/migration-runner.test.ts` with tests for:
- creates _migrations table
- applies a single SQL migration file
- applies migrations in numeric order
- does not re-apply on second open
- tracks migration filenames in _migrations
- sets WAL and foreign_keys pragmas
- handles empty migrations directory gracefully

All tests write .sql files to a temp migrations dir, call runMigrations, and verify via SiaDb queries.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:unit -- tests/unit/graph/migration-runner.test.ts`
Expected: FAIL (runMigrations not exported)

- [ ] **Step 3: Implement migration runner**

Replace `src/graph/semantic-db.ts` stub with `runMigrations(dbPath, migrationsDir)`:
- Creates parent directory if needed
- Opens bun:sqlite Database
- Sets WAL/NORMAL/FK pragmas
- Creates `_migrations` table if not exists
- Reads applied migration names from _migrations
- Reads .sql files from migrationsDir, sorts alphabetically
- Applies unapplied migrations in order, records each in _migrations
- Returns BunSqliteDb wrapping the connection

- [ ] **Step 4: Run tests**

Run: `bun run test:unit -- tests/unit/graph/migration-runner.test.ts`
Expected: all 7 tests PASS

- [ ] **Step 5: Lint and commit**

Commit:
```
feat(graph): implement migration runner
```

---

## Task 4: Database Opener Helpers

**Files:**
- Modify: `src/graph/semantic-db.ts` (add openGraphDb, openEpisodicDb)
- Modify: `src/graph/meta-db.ts` (add openMetaDb)
- Modify: `src/graph/bridge-db.ts` (add openBridgeDb)
- Create: `tests/unit/graph/db-openers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/graph/db-openers.test.ts` with tests for:
- openGraphDb opens graph.db with _migrations table
- openEpisodicDb opens episodic.db with _migrations table
- openMetaDb opens meta.db at sia home root
- openBridgeDb opens bridge.db at sia home root

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:unit -- tests/unit/graph/db-openers.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement opener helpers**

Add to `src/graph/semantic-db.ts`:
- `openGraphDb(repoHash, siaHome?)` — calls runMigrations with `migrations/semantic` dir
- `openEpisodicDb(repoHash, siaHome?)` — calls runMigrations with `migrations/episodic` dir

Replace `src/graph/meta-db.ts` stub:
- `openMetaDb(siaHome?)` — calls runMigrations with `migrations/meta` dir

Replace `src/graph/bridge-db.ts` stub:
- `openBridgeDb(siaHome?)` — calls runMigrations with `migrations/bridge` dir

- [ ] **Step 4: Run tests**

Run: `bun run test:unit -- tests/unit/graph/db-openers.test.ts`
Expected: all 4 PASS

- [ ] **Step 5: Full test suite + lint + commit**

Run: `bun run test:unit && bun run lint`

Commit:
```
feat(graph): add database opener helpers for all 4 databases
```

---

## Task 5: Final Validation

- [ ] **Step 1: Run full test suite**

Run: `bun run test:unit`
Expected: all tests PASS (scaffold + db adapter + migration + opener tests)

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: clean

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 4: Push branch**

Run: `git push -u origin phase-1/storage-foundation`

---

## Execution Order

1. **Task 1** — SiaDb interface + BunSqliteDb (core abstraction, no dependencies)
2. **Task 2** — openDb + openSiaDb (depends on Task 1 + SyncConfig type)
3. **Task 3** — Migration runner (depends on Task 1 for BunSqliteDb)
4. **Task 4** — Database opener helpers (depends on Tasks 2 + 3)
5. **Task 5** — Validation and push
