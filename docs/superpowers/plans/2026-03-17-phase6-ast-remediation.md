# Phase 6: AST Backbone Remediation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical and important bugs in the Codex-generated Phase 6 code — indexer tier dispatch, watcher reliability, PageRank correctness, path-utils gitignore handling, and reindex CLI completeness.

**Architecture:** The indexer gets a tier-dispatch layer that routes files to the correct extractor by `LanguageConfig.tier`. The watcher drops polling in favor of chokidar-only with an awaitable `stop()`. PageRank gets O(n) adjacency, fixed teleport, and batched DB writes. Path-utils adds gitignore negation and directory-only pattern support.

**Tech Stack:** Bun, TypeScript strict, SiaDb adapter, Vitest with better-sqlite3 shim, Biome 2.x

**Branch:** `phase-6/ast-remediation`

**Important:** Do NOT add Co-Authored-By to commit messages.

---

## File Structure

### New files:
- `src/ast/extractors/tier-dispatch.ts` — Dispatch function routing by LanguageConfig.tier
- `src/ast/extractors/prisma-schema.ts` — Regex-based Prisma model extraction
- `tests/unit/ast/extractors.test.ts` — Tests for all Tier C/D extractors + dispatch
- `tests/unit/ast/path-utils.test.ts` — Tests for gitignore negation + directory-only patterns

### Stub replacements (files exist as empty stubs, will be replaced with real implementations):
- `src/ast/extractors/sql-schema.ts` — Regex-based SQL CREATE TABLE/INDEX extraction
- `src/ast/extractors/project-manifest.ts` — Cargo.toml/go.mod/pyproject.toml dep extraction

### Files to modify:
- `src/ast/indexer.ts` — Use tier dispatch instead of direct extractTrackA, add dedup
- `src/ast/watcher.ts` — Fix FileWatcher interface, remove polling, fix rename, update content
- `src/ast/pagerank-builder.ts` — O(n) adjacency, fixed teleport, batch updates, convergence return
- `src/ast/path-utils.ts` — Gitignore negation patterns, directory-only patterns
- `src/cli/commands/reindex.ts` — Add monorepo+contract re-detection, progress format
- `tests/unit/ast/indexer.test.ts` — Add gitignore, onProgress, dedup tests
- `tests/unit/ast/watcher.test.ts` — Fix ready type, add rename test, remove setTimeout
- `tests/unit/ast/pagerank.test.ts` — Add empty graph, invalidated edge, convergence tests
- `tests/unit/ast/reindex.test.ts` — Add missing .git error test

---

## Task 1: Tier Dispatch & Extractors

**Files:**
- Create: `src/ast/extractors/tier-dispatch.ts`
- Create: `src/ast/extractors/sql-schema.ts`
- Create: `src/ast/extractors/prisma-schema.ts`
- Create: `src/ast/extractors/project-manifest.ts`
- Create: `tests/unit/ast/extractors.test.ts`
- Modify: `src/ast/indexer.ts`

**Context:** The indexer currently calls `extractTrackA` for all files regardless of language tier. Tier C (SQL, Prisma) and Tier D (manifests) need specialized extractors. Tier A/B continue using `extractTrackA` (regex) until Tree-sitter is added.

- [ ] **Step 1: Write tier-dispatch.ts**

Create `src/ast/extractors/tier-dispatch.ts`:
- Import `extractTrackA` from `@/capture/track-a-ast`
- Import extractors from `./sql-schema`, `./prisma-schema`, `./project-manifest`
- Export `dispatchExtraction(content: string, filePath: string, tier: ExtractionTier, specialHandling?: SpecialHandling): CandidateFact[]`
- Tier A/B: call `extractTrackA(content, filePath)`
- Tier C with `sql-schema`: call `extractSqlSchema(content, filePath)`
- Tier C with `prisma-schema`: call `extractPrismaSchema(content, filePath)`
- Tier D with `project-manifest`: call `extractManifest(content, filePath)`
- Default: return empty array

- [ ] **Step 2: Write sql-schema.ts extractor**

Create `src/ast/extractors/sql-schema.ts`:
- Export `extractSqlSchema(content: string, filePath: string): CandidateFact[]`
- Regex for `CREATE TABLE (\w+)` — produces CodeEntity with tags `["table"]`
- Regex for `CREATE INDEX (\w+)` — produces CodeEntity with tags `["index"]`
- Regex for `FOREIGN KEY.*REFERENCES (\w+)` — produces relationship info in content
- All facts get `trust_tier: 2`, `confidence: 0.90`, `extraction_method: "sql-schema"`

- [ ] **Step 3: Write prisma-schema.ts extractor**

Create `src/ast/extractors/prisma-schema.ts`:
- Export `extractPrismaSchema(content: string, filePath: string): CandidateFact[]`
- Regex for `model (\w+) \{` — produces CodeEntity with tags `["model"]`
- Extract field lines within model blocks for summary
- All facts get `trust_tier: 2`, `confidence: 0.90`, `extraction_method: "prisma-schema"`

- [ ] **Step 4: Write project-manifest.ts extractor**

Create `src/ast/extractors/project-manifest.ts`:
- Export `extractManifest(content: string, filePath: string): CandidateFact[]`
- If `Cargo.toml`: extract `[workspace] members = [...]` entries
- If `go.mod`: extract `replace ... => <local-path>` directives
- If `pyproject.toml`: extract `path = "..."` dependencies
- All facts get `trust_tier: 2`, `confidence: 0.85`, `extraction_method: "manifest"`, type `"Dependency"`

- [ ] **Step 5: Write extractor tests**

Create `tests/unit/ast/extractors.test.ts` with:
- SQL: `CREATE TABLE users (...)` produces entity named "users" with tags containing "table"
- SQL: `CREATE INDEX idx_name ON ...` produces entity named "idx_name"
- Prisma: `model User { ... }` produces entity named "User" with tags containing "model"
- Manifest: Cargo.toml with workspace members produces Dependency facts
- Manifest: go.mod with replace directive produces Dependency facts
- Dispatch: `.sql` file routes to SQL extractor, `.ts` file routes to extractTrackA
- Dispatch: unknown tier returns empty array

- [ ] **Step 6: Run extractor tests**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test -- tests/unit/ast/extractors.test.ts
```

- [ ] **Step 7: Wire tier dispatch into indexer.ts**

Modify `src/ast/indexer.ts`:
- Replace `import { extractTrackA }` with `import { dispatchExtraction }` from `@/ast/extractors/tier-dispatch`
- The existing `getLanguageForFile(absPath)` call on line 85 already returns a `LanguageConfig` with `tier` and `specialHandling`. **Do NOT use `getLanguageByExtension`** — it won't match Tier D manifest files like `Cargo.toml` and `go.mod` whose "extensions" are full filenames.
- Replace `extractTrackA(content, relPath)` (line 98) with:
  ```typescript
  const facts = language
    ? dispatchExtraction(content, relPath, language.tier, language.specialHandling)
    : [];
  ```
  where `language` is the already-resolved `getLanguageForFile(absPath)` result from line 85.

- [ ] **Step 8: Add dedup to indexer**

Before `insertEntity` in the indexer loop, query for existing entity:
```typescript
const existing = await db.execute(
  `SELECT id FROM entities
   WHERE name = ? AND file_paths LIKE ? AND t_valid_until IS NULL AND archived_at IS NULL`,
  [fact.name, `%${relPath}%`],
);
if (existing.rows.length > 0) {
  await updateEntity(db, existing.rows[0].id as string, {
    content: fact.content,
    summary: fact.summary,
    tags: JSON.stringify(fact.tags ?? []),
  });
} else {
  await insertEntity(db, { ... });
}
```
Import `updateEntity` from `@/graph/entities`.

- [ ] **Step 9: Add dedup test to indexer.test.ts**

Add to `tests/unit/ast/indexer.test.ts`:
```typescript
it("updates existing entities instead of creating duplicates on re-index", async () => {
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  writeFileSync(join(repoRoot, "src", "dup.ts"), "export function dup() { return 1; }", "utf-8");
  await indexRepository(repoRoot, db, config, { repoHash });

  // Modify file content
  writeFileSync(join(repoRoot, "src", "dup.ts"), "export function dup() { return 2; }", "utf-8");
  // Clear cache to force re-processing
  const cachePath = join(config.astCacheDir, repoHash, "index-cache.json");
  writeFileSync(cachePath, "{}", "utf-8");

  await indexRepository(repoRoot, db, config, { repoHash });

  const rows = await db.execute(
    "SELECT COUNT(*) as cnt FROM entities WHERE name = 'dup' AND t_valid_until IS NULL",
  );
  expect(rows.rows[0]?.cnt).toBe(1);
});
```

- [ ] **Step 10: Run all indexer tests**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test -- tests/unit/ast/indexer.test.ts tests/unit/ast/extractors.test.ts
```

- [ ] **Step 11: Commit**

```bash
git add src/ast/extractors/ src/ast/indexer.ts tests/unit/ast/extractors.test.ts tests/unit/ast/indexer.test.ts
git commit -m "feat(ast): add tier dispatch, C/D extractors, and indexer dedup"
```

---

## Task 2: Watcher Fixes

**Files:**
- Modify: `src/ast/watcher.ts`
- Modify: `tests/unit/ast/watcher.test.ts`

**Context:** 5 interacting bugs: FileWatcher interface missing `ready`, dual polling+chokidar, broken rename handler, entity content never updated, non-awaitable `stop()`.

- [ ] **Step 1: Fix FileWatcher interface and stop() return type**

In `src/ast/watcher.ts`, change the interface:
```typescript
export interface FileWatcher {
  start(): void;
  stop(): Promise<void>;
  ready: Promise<void>;
}
```

- [ ] **Step 2: Remove polling — delete startPolling and setInterval**

Remove the `PollState` interface, the `pollState` variable, and the entire `startPolling` function (lines 189-199). Remove the `startPolling()` call from `start()` (line 207). Remove `clearInterval` from `stop()`.

- [ ] **Step 3: Move initial syncOnce to after chokidar ready**

In the `start()` method, call `syncOnce()` inside the `onReady` callback (after chokidar signals ready):
```typescript
() => {
  void syncOnce().then(() => readyResolve());
},
```

- [ ] **Step 4: Fix rename handler in fs.watch fallback**

Replace lines 123-129:
```typescript
if (eventType === "rename") {
  if (existsSync(absPath)) {
    onChange(absPath);
  } else {
    onDelete(absPath);
  }
  return;
}
```
Add `import { existsSync } from "node:fs"`.

- [ ] **Step 5: Update existing entity content in handleChange**

Replace the skip at line 55 (`if (existingByName.has(fact.name)) continue;`) with:
```typescript
const existingId = existingByName.get(fact.name);
if (existingId) {
  // Update content if changed
  const existingEntity = await db.execute(
    "SELECT content FROM entities WHERE id = ?", [existingId]
  );
  if (existingEntity.rows[0]?.content !== fact.content) {
    await updateEntity(db, existingId, {
      content: fact.content,
      summary: fact.summary,
    });
  }
  continue;
}
```
Add `import { updateEntity } from "@/graph/entities"` (add to existing import).

- [ ] **Step 6: Remove unused _rel variable**

Delete line 121: `const _rel = toPosixPath(relative(root, absPath));`

- [ ] **Step 7: Make stop() return Promise<void>**

Change `stop` to return the promise instead of fire-and-forget:
```typescript
const stop = async (): Promise<void> => {
  await syncOnce();
  if (closer) {
    await closer.close();
    closer = null;
  }
};
```

- [ ] **Step 8: Fix tests — remove unknown cast, use polling wait**

In `tests/unit/ast/watcher.test.ts`:
- Replace `(watcher as unknown as { ready: Promise<void> }).ready` with `watcher.ready`
- Replace `await new Promise((resolveDelay) => setTimeout(resolveDelay, 700))` with a polling helper:
```typescript
async function waitForCondition(
  check: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Condition not met within timeout");
}
```
- Replace `watcher.stop()` with `await watcher.stop()`

- [ ] **Step 9: Add rename test**

```typescript
it("handles file rename (delete + add)", async () => {
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  const oldPath = join(repoRoot, "src", "old-name.ts");
  writeFileSync(oldPath, "export function renamed() {}", "utf-8");
  await indexRepository(repoRoot, db, config, { repoHash });

  const watcher = createWatcher(repoRoot, db, config);
  watcher.start();
  await watcher.ready;

  // Simulate rename: delete old, create new
  rmSync(oldPath);
  writeFileSync(join(repoRoot, "src", "new-name.ts"), "export function renamed() {}", "utf-8");

  await waitForCondition(async () => {
    const rows = await db.execute(
      "SELECT COUNT(*) as cnt FROM entities WHERE name = 'renamed' AND t_valid_until IS NULL",
    );
    return (rows.rows[0]?.cnt as number) >= 1;
  });

  await watcher.stop();

  // Old file's entity should be invalidated
  const oldRows = await db.execute(
    "SELECT t_valid_until FROM entities WHERE file_paths LIKE '%old-name.ts%'",
  );
  if (oldRows.rows.length > 0) {
    expect(oldRows.rows[0]?.t_valid_until).not.toBeNull();
  }
});
```

- [ ] **Step 10: Run watcher tests**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test -- tests/unit/ast/watcher.test.ts
```

- [ ] **Step 11: Commit**

```bash
git add src/ast/watcher.ts tests/unit/ast/watcher.test.ts
git commit -m "fix(ast): fix watcher — awaitable stop, remove polling, fix rename, update content"
```

---

## Task 3: PageRank & Path Utils

**Files:**
- Modify: `src/ast/pagerank-builder.ts`
- Modify: `src/ast/path-utils.ts`
- Modify: `tests/unit/ast/pagerank.test.ts`

- [ ] **Step 1: Fix O(n) adjacency in pagerank-builder.ts**

Replace lines 34-35:
```typescript
// Old: outgoing.set(edge.from_id, [...(outgoing.get(edge.from_id) ?? []), edge.to_id]);
// New:
if (!outgoing.has(edge.from_id)) outgoing.set(edge.from_id, []);
outgoing.get(edge.from_id)!.push(edge.to_id);

if (!incoming.has(edge.to_id)) incoming.set(edge.to_id, []);
incoming.get(edge.to_id)!.push(edge.from_id);
```

- [ ] **Step 2: Fix teleport vector for non-active nodes**

In `buildTeleportVector`, replace line 17:
```typescript
// Old: return new Map(nodes.map((id) => [id, bias.has(id) ? weight : 0]));
// New:
const epsilon = 0.01;
const activeWeight = (1 - epsilon) / bias.size;
const passiveWeight = epsilon / nodes.length;
return new Map(nodes.map((id) => [id, bias.has(id) ? activeWeight : passiveWeight]));
```

- [ ] **Step 3: Batch entity updates**

Replace `Promise.all` at lines 82-84:
```typescript
const BATCH_SIZE = 500;
for (let i = 0; i < nodeList.length; i += BATCH_SIZE) {
  const batch = nodeList.slice(i, i + BATCH_SIZE);
  const statements = batch.map((id) => ({
    sql: "UPDATE entities SET importance = ? WHERE id = ?",
    params: [scores.get(id) ?? 0, id],
  }));
  await db.executeMany(statements);
}
```

- [ ] **Step 4: Add convergence return value**

Change return type from `Promise<void>` to `Promise<PageRankResult>`:
```typescript
export interface PageRankResult {
  iterations: number;
  converged: boolean;
  finalDelta: number;
  nodesScored: number;
}
```
Update the early return for empty graphs (line 38-39) to return `{ iterations: 0, converged: true, finalDelta: 0, nodesScored: 0 }` instead of bare `return`. Track iteration count and final delta throughout the loop. Return the result. Log warning if not converged:
```typescript
if (!converged) {
  console.warn(`PageRank did not converge after ${maxIter} iterations (delta=${finalDelta})`);
}
```

- [ ] **Step 5: Fix gitignore negation patterns in path-utils.ts**

In `loadGitignorePatterns`, split lines into `ignorePatterns` and `negationPatterns`:
```typescript
const ignoreLines: string[] = [];
const negationLines: string[] = [];
for (const line of filteredLines) {
  if (line.startsWith("!")) {
    negationLines.push(line.slice(1));
  } else {
    ignoreLines.push(line);
  }
}
```
Return both as `{ ignore: RegExp[], negate: RegExp[] }`.

Update `createIgnoreMatcher` to use the new return type — `loadGitignorePatterns` now returns `{ ignore: GitignoreRule[], negate: GitignoreRule[] }` where `GitignoreRule = { regex: RegExp; dirOnly: boolean }`. Replace the existing gitignore loop in `shouldIgnore` with:
```typescript
// Apply gitignore patterns with negation support
let gitIgnored = false;
for (const rule of gitignoreResult.ignore) {
  if (rule.dirOnly && !isDir) continue;
  if (rule.regex.test(rel)) { gitIgnored = true; break; }
}
if (gitIgnored) {
  for (const rule of gitignoreResult.negate) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.regex.test(rel)) { gitIgnored = false; break; }
  }
}
if (gitIgnored) return true;
```
Also remove the redundant trailing-slash check loop (lines 84-88) since directory-only patterns are now handled by the `dirOnly` flag.

- [ ] **Step 6: Fix gitignore directory-only patterns**

In `patternToRegExp`, when pattern ends with `/`, only match directories:
```typescript
export function patternToRegExp(pattern: string, dirOnly = false): RegExp {
  // ... existing logic ...
  // dirOnly flag is set when the original pattern ended with /
}
```
In `loadGitignorePatterns`, detect and strip trailing `/`:
```typescript
const isDirOnly = line.endsWith("/");
const cleanLine = isDirOnly ? line.slice(0, -1) : line;
return { regex: patternToRegExp(cleanLine), dirOnly: isDirOnly };
```
In `shouldIgnore`, only apply dirOnly patterns when `isDir === true`.

- [ ] **Step 7: Add path-utils tests**

Create `tests/unit/ast/path-utils.test.ts`:
```typescript
it("gitignore negation pattern un-ignores a file", () => {
  // Write .gitignore with "*.log\n!important.log"
  // Verify important.log is NOT ignored
  // Verify other.log IS ignored
});

it("directory-only pattern ignores directory but not file", () => {
  // Write .gitignore with "logs/"
  // Verify logs/ directory IS ignored (isDir=true)
  // Verify a file named "logs" is NOT ignored (isDir=false)
});
```

- [ ] **Step 8: Add PageRank tests**

Add to `tests/unit/ast/pagerank.test.ts`:
```typescript
it("returns early for empty graph", async () => {
  const result = await computePageRank(db);
  expect(result.nodesScored).toBe(0);
  expect(result.converged).toBe(true);
});

it("excludes invalidated edges from computation", async () => {
  const a = await insertEntity(db, { type: "CodeEntity", name: "EdgeA", content: "A", summary: "A", trust_tier: 2, confidence: 0.92 });
  const b = await insertEntity(db, { type: "CodeEntity", name: "EdgeB", content: "B", summary: "B", trust_tier: 2, confidence: 0.92 });
  const edge = await insertEdge(db, { from_id: b.id, to_id: a.id, type: "imports" });
  await invalidateEdge(db, edge.id);

  const result = await computePageRank(db);
  expect(result.nodesScored).toBe(0); // No active edges = no nodes in graph
});

it("returns convergence metrics", async () => {
  const a = await insertEntity(db, { type: "CodeEntity", name: "ConvA", content: "A", summary: "A", trust_tier: 2, confidence: 0.92 });
  const b = await insertEntity(db, { type: "CodeEntity", name: "ConvB", content: "B", summary: "B", trust_tier: 2, confidence: 0.92 });
  await insertEdge(db, { from_id: a.id, to_id: b.id, type: "calls" });

  const result = await computePageRank(db);
  expect(result.converged).toBe(true);
  expect(result.iterations).toBeGreaterThan(0);
  expect(result.finalDelta).toBeLessThan(1e-6);
  expect(result.nodesScored).toBe(2);
});
```
Import `invalidateEdge` at top.

- [ ] **Step 9: Run tests**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test -- tests/unit/ast/pagerank.test.ts tests/unit/ast/path-utils.test.ts
```

- [ ] **Step 10: Commit**

```bash
git add src/ast/pagerank-builder.ts src/ast/path-utils.ts tests/unit/ast/pagerank.test.ts tests/unit/ast/path-utils.test.ts
git commit -m "fix(ast): O(n) adjacency, fixed teleport, batch updates, gitignore negation"
```

---

## Task 4: Reindex CLI & Test Gaps

**Files:**
- Modify: `src/cli/commands/reindex.ts`
- Modify: `tests/unit/ast/indexer.test.ts`
- Modify: `tests/unit/ast/reindex.test.ts`

- [ ] **Step 1: Add monorepo + contract re-detection to reindex**

In `src/cli/commands/reindex.ts`, after opening the graph DB and before `indexRepository`:
```typescript
import { openMetaDb, registerRepo } from "@/graph/meta-db";
import { detectMonorepoPackages, registerMonorepoPackages } from "@/workspace/detector";
import { detectApiContracts, writeDetectedContracts } from "@/workspace/api-contracts";

// Inside siaReindex, after opening graphDb:
const metaDb = openMetaDb(opts.siaHome);
try {
  const repoId = await registerRepo(metaDb, resolvedRoot);

  // Re-detect monorepo structure
  const packages = await detectMonorepoPackages(resolvedRoot);
  if (packages.length > 0) {
    await registerMonorepoPackages(metaDb, repoId, resolvedRoot, packages);
  }

  // Re-detect API contracts
  const contracts = await detectApiContracts(resolvedRoot);
  if (contracts.length > 0) {
    await writeDetectedContracts(metaDb, repoId, contracts);
  }
} finally {
  await metaDb.close();
}
```

- [ ] **Step 2: Improve progress format**

Replace the `onProgress` callback:
```typescript
onProgress: ({ filesProcessed, entitiesCreated, file }) => {
  const prefix = opts.dryRun ? "(dry-run) " : "";
  console.log(`${prefix}[${filesProcessed}] ${file ?? "..."} (${entitiesCreated} entities)`);
},
```

- [ ] **Step 3: Add indexer test for .gitignore exclusion**

Add to `tests/unit/ast/indexer.test.ts`:
```typescript
it("respects .gitignore patterns", async () => {
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  mkdirSync(join(repoRoot, "vendor"), { recursive: true });
  writeFileSync(join(repoRoot, ".gitignore"), "vendor/\n", "utf-8");
  writeFileSync(join(repoRoot, "src", "kept.ts"), "export function kept() {}", "utf-8");
  writeFileSync(join(repoRoot, "vendor", "ignored.ts"), "export function ignored() {}", "utf-8");

  const result = await indexRepository(repoRoot, db, config, { repoHash });
  const rows = await db.execute("SELECT name FROM entities WHERE t_valid_until IS NULL");
  const names = rows.rows.map((r) => r.name);
  expect(names).toContain("kept");
  expect(names).not.toContain("ignored");
});
```

- [ ] **Step 4: Add indexer test for onProgress callback**

```typescript
it("calls onProgress for each processed file", async () => {
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  writeFileSync(join(repoRoot, "src", "a.ts"), "export function a() {}", "utf-8");
  writeFileSync(join(repoRoot, "src", "b.ts"), "export function b() {}", "utf-8");

  const progressCalls: string[] = [];
  await indexRepository(repoRoot, db, config, {
    repoHash,
    onProgress: (p) => { if (p.file) progressCalls.push(p.file); },
  });

  expect(progressCalls).toHaveLength(2);
  expect(progressCalls).toContain("src/a.ts");
  expect(progressCalls).toContain("src/b.ts");
});
```

- [ ] **Step 5: Add reindex test for missing .git**

Add to `tests/unit/ast/reindex.test.ts`:
```typescript
it("throws when no .git directory found", async () => {
  const noGitDir = mkdtempSync(join(tmpdir(), "sia-reindex-nogit-"));
  try {
    await expect(siaReindex({ cwd: noGitDir, siaHome })).rejects.toThrow(/No .git directory/);
  } finally {
    rmSync(noGitDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run all tests**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test -- tests/unit/ast/ tests/unit/cli/
```

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/reindex.ts tests/unit/ast/indexer.test.ts tests/unit/ast/reindex.test.ts
git commit -m "feat(ast): add monorepo/contract re-detection to reindex, fill test gaps"
```

---

## Task 5: Final Integration

- [ ] **Step 1: Run full test suite**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test
```

- [ ] **Step 2: Run linter and fix**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run lint
```
Fix with: `bun run lint:fix -- --unsafe`

- [ ] **Step 3: Commit lint fixes if needed**

```bash
git add -A && git commit -m "chore: fix lint issues from phase 6 remediation"
```

---

## Execution Order

```
Task 1 (extractors + dispatch + dedup) ─── foundational, everything else builds on this
         │
Task 2 (watcher fixes) ─── independent of Task 1 but touches same module area
         │
Task 3 (pagerank + path-utils) ─── independent of Tasks 1-2
         │
Task 4 (reindex + test gaps) ─── depends on Task 1 (uses dispatch in indexer)
         │
Task 5 (integration) ─── depends on all above
```

**Optimal execution:** Tasks 1+3 in parallel → Task 2 → Task 4 → Task 5
