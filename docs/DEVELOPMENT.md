# Sia — Development Guide

## What is Sia
Persistent graph memory for AI coding agents. MCP server + hooks + capture pipeline that gives Claude Code cross-session memory via a bi-temporal knowledge graph.

## Tech Stack
- **Runtime:** Bun 1.x
- **Language:** TypeScript (strict mode)
- **Database:** SQLite via bun:sqlite (wrapped in SiaDb adapter)
- **Linting:** Biome 2.x
- **Testing:** Vitest 4.x (runs in Node.js with better-sqlite3 shim)
- **Package manager:** Bun

## Commands
```bash
bun run test          # Run unit tests
bun run test:unit     # Same as above
bun run test:integration  # Integration tests
bun run lint          # Check lint
bun run lint:fix -- --unsafe  # Auto-fix lint issues
bun run typecheck     # TypeScript type checking
```

## Architecture
All database access goes through the `SiaDb` interface (`src/graph/db-interface.ts`). Never use raw `bun:sqlite` directly in CRUD code — always accept `SiaDb` as a parameter.

### Key abstractions
- **SiaDb** — async interface wrapping bun:sqlite (local) and @libsql/client (sync mode)
- **BunSqliteDb** — primary implementation for local-only mode
- **runMigrations(dbPath, migrationsDir)** — applies numbered .sql files, returns SiaDb
- **openGraphDb/openEpisodicDb/openMetaDb/openBridgeDb** — per-database openers

### Four databases
- `meta.db` — workspace/repo registry, sharing rules, API contracts, sync config
- `bridge.db` — cross-repo edges (workspace members only)
- `graph.db` (per-repo) — entities, edges, communities, staging, flags, audit log
- `episodic.db` (per-repo) — append-only interaction archive

### Bi-temporal model
Entities and edges carry 4 timestamps: t_created, t_expired, t_valid_from, t_valid_until. Two distinct invalidation operations:
- `invalidateEntity` — fact was superseded (sets t_valid_until + t_expired)
- `archiveEntity` — entity decayed to irrelevance (sets archived_at only)
Never confuse these.

## Testing conventions
- Tests use temp directories cleaned in afterEach
- bun:sqlite is shimmed via `tests/__mocks__/bun-sqlite.ts` (re-exports better-sqlite3)
- vitest.config.ts has a "bun:sqlite" alias for the shim
- Use `openGraphDb(repoHash, tempDir)` to get a db with full schema for tests

## Path aliases
`@/graph/*`, `@/capture/*`, `@/ast/*`, `@/retrieval/*`, `@/mcp/*`, `@/security/*`, `@/sync/*`, `@/decay/*`, `@/cli/*`, `@/shared/*`, `@/workspace/*`, `@/agent/*`

## Specs
All specifications live in `plans/`:
- `SIA_PRD.md` — Product requirements
- `SIA_ARCHI.md` — Architecture & technical spec (authoritative for schemas, interfaces)
- `SIA_TASKS.md` — Engineering backlog (12 phases, acceptance criteria)
- `SIA_CLAUDE_MD.md` — Agent behavioral specification

## Git workflow
- Use branches named after phases: `phase-N/description`
- Do not add Co-Authored-By to commit messages
- Merge to main after each phase completes
