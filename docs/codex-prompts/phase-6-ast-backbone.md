# Codex Task: Phase 6 — AST Backbone and Structural Graph

## Setup

```bash
git fetch origin
git checkout -b phase-6/ast-backbone v0.1.0-foundation
```

## Context

You are implementing the AST backbone for Sia — a persistent graph memory system for AI coding agents. The codebase already has: SiaDb adapter (`src/graph/db-interface.ts`), entity/edge CRUD (`src/graph/entities.ts`, `src/graph/edges.ts`), migration runner (`src/graph/semantic-db.ts`), config loading (`src/shared/config.ts`), and a capture pipeline (`src/capture/pipeline.ts`).

**Tech stack:** Bun runtime, TypeScript strict, Vitest for tests, Biome for linting. All DB access goes through the `SiaDb` interface. Use `PATH="$HOME/.bun/bin:$PATH"` before bun commands.

**Run tests:** `bun run test:unit`
**Run lint:** `bun run lint`

## What to Build

### Task 6.1 — Full-Repo Indexer (`src/ast/indexer.ts`) [BLOCKING]

Replace the stub. Export `indexRepository(repoRoot: string, db: SiaDb, config: SiaConfig): Promise<IndexResult>`:

- Walk the repository tree (respecting `.gitignore` and `config.excludePaths` if present)
- For each file: look up extension in the language registry (`src/ast/languages.ts`)
- Dispatch to the appropriate extractor (Track A: `src/capture/track-a-ast.ts` already has regex extraction for TS/JS/Python/Go/Rust)
- Write extracted entities via `insertEntity` from `src/graph/entities.ts`
- Tag each entity with correct `package_path` for monorepos
- Use a persistent disk cache at `{config.astCacheDir}/{repoHash}/` keyed by `relative-file-path + mtime` — skip files that haven't changed
- Report progress via callback or return `IndexResult: { filesProcessed: number; entitiesCreated: number; cacheHits: number; durationMs: number }`

**Acceptance criteria:** Full indexing of a test directory with mixed TS/Python files extracts entities correctly. Re-run with no file changes = all cache hits. Correct `package_path` set when monorepo packages detected.

### Task 6.2 — Incremental File Watcher (`src/ast/watcher.ts`)

Replace the stub. Uses `chokidar` (install it: `bun add chokidar`). Export `createWatcher(repoRoot: string, db: SiaDb, config: SiaConfig): FileWatcher`:

- On file change: re-parse via Track A extraction, diff against cached facts, write ADD for new entities, call `invalidateEdge` for removed relationships
- On file delete: call `invalidateEntity` on all structural entities for that file path (sets `t_valid_until`, NOT `archived_at`)
- `FileWatcher` interface: `{ start(): void; stop(): void; }`

**Acceptance criteria:** New function in a TS file produces a new CodeEntity within 500ms. Deleted file calls `invalidateEntity` on its entities.

### Task 6.3 — PersonalizedPageRank (`src/ast/pagerank-builder.ts`)

Replace the stub. Export `computePageRank(db: SiaDb, activeFileIds?: string[]): Promise<void>`:

- Build adjacency from structural graph edges (`calls`, `imports`, `inherits_from`) — active edges only (`t_valid_until IS NULL`)
- Compute PersonalizedPageRank biased toward `activeFileIds` (files accessed in last 30 min)
- Store scores as `importance` on CodeEntity nodes via `updateEntity`
- Recompute incrementally after structural graph updates

**Acceptance criteria:** Heavily-imported files have higher importance scores. Only active edges included.

### Task 6.4 — Language Registry (`src/ast/languages.ts`)

Replace the stub. Export `LANGUAGE_REGISTRY: Map<string, LanguageConfig>` and `LanguageConfig` interface:

```typescript
interface LanguageConfig {
  name: string;
  extensions: string[];
  tier: 'A' | 'B' | 'C' | 'D';
  grammar?: string; // tree-sitter grammar npm package
  specialHandling?: string; // 'c-include' | 'csharp-project' | 'sql-schema' | 'project-manifest'
}
```

Populate with all languages from this list:
- **Tier A** (full): TypeScript (.ts/.tsx), JavaScript (.js/.jsx), Python (.py), Go (.go), Rust (.rs), Java (.java), Kotlin (.kt), Swift (.swift), PHP (.php), Ruby (.rb), Scala (.scala), Elixir (.ex/.exs), Dart (.dart)
- **Tier B** (structural): C (.c/.h), C++ (.cpp/.hpp/.cc), C# (.cs), Bash (.sh/.bash), Lua (.lua), Zig (.zig), Perl (.pl), R (.r/.R), OCaml (.ml), Haskell (.hs)
- **Tier C** (schema): SQL (.sql), Prisma (.prisma)
- **Tier D** (manifest): Cargo.toml, go.mod, pyproject.toml, .csproj, build.gradle, pom.xml

Export `getLanguageForFile(filePath: string): LanguageConfig | undefined` — looks up by extension.

Export `mergeAdditionalLanguages(additional: AdditionalLanguage[]): void` — merges user-defined languages from config.

**Acceptance criteria:** All listed languages are in the registry. `getLanguageForFile("foo.ts")` returns TS config. Adding a language via `mergeAdditionalLanguages` makes it queryable.

### Task 6.5 — `npx sia reindex` CLI (`src/cli/commands/reindex.ts`)

Replace the stub. Wire to the full-repo indexer. Support `--dry-run`. Print progress and summary.

**Acceptance criteria:** Progress output is readable. `--dry-run` reports without writing. Re-detects new packages.

## Tests

Create test files in `tests/unit/ast/`:
- `indexer.test.ts` — tests indexing a temp directory with TS + Python files
- `watcher.test.ts` — tests file change/delete detection
- `pagerank.test.ts` — tests importance scoring
- `languages.test.ts` — tests registry lookup and merge
- `reindex.test.ts` — tests CLI command

## Validation Before Pushing

```bash
bun run test:unit   # ALL tests must pass (existing + new)
bun run lint        # Must be clean
git push -u origin phase-6/ast-backbone
```

## Important Notes

- Import `SiaDb` from `@/graph/db-interface`, entities CRUD from `@/graph/entities`, edges from `@/graph/edges`
- Use `openGraphDb(repoHash, siaHome)` from `@/graph/semantic-db` for tests
- Entity types: 'CodeEntity' for structural entities, trust_tier=2, confidence=0.92
- Never hard-delete entities — use `invalidateEntity` (sets `t_valid_until`)
- The `archiveEntity` function is for decay only, NOT for structural removal
- Do NOT add Co-Authored-By to commits
