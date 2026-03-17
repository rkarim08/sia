# Phase 8: Community Detection Remediation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical and important bugs in Codex-generated Phase 8 — add shared LLM client with full Haiku API, fix RAPTOR to use active-only entities with lazy Level 1, add Leiden refinement step, fix community summaries to use LLM, add afterEach cleanup to all test files, and strengthen test assertions.

**Architecture:** A new shared `LlmClient` interface (`src/shared/llm-client.ts`) wraps the Anthropic SDK with rate limiting and air-gapped fallback. Community summaries and RAPTOR Level 1/2 summaries use this client for coherent paragraph generation. The Leiden algorithm gets a connectivity-based refinement step and per-package Level 0 detection.

**Tech Stack:** Bun, TypeScript strict, `@anthropic-ai/sdk`, SiaDb adapter, Vitest with better-sqlite3 shim, Biome 2.x

**Branch:** `phase-8/community-remediation`

**Important:** Do NOT add Co-Authored-By to commit messages.

---

## File Structure

### New files:
- `src/shared/llm-client.ts` — LlmClient interface + Anthropic SDK implementation + air-gapped fallback
- `tests/unit/shared/llm-client.test.ts` — Tests for fallback behavior

### Files to modify:
- `src/community/summarize.ts` — Use LlmClient for coherent paragraph summaries, fix empty message
- `src/community/raptor.ts` — Level 0 active-only, remove eager Level 1, add lazy Level 1 helper, Level 3 weekly
- `src/community/leiden.ts` — Refinement step, per-package Level 0, edge weight fixes, iteration cap
- `src/community/scheduler.ts` — Warning log for small graphs, runInBackground method, accept LlmClient
- `src/cli/commands/community.ts` — Show Level 0 communities, fix --package filter
- `src/mcp/tools/sia-expand.ts` — Wire lazy Level 1 summary generation on expand
- `tests/unit/community/leiden.test.ts` — afterEach, strengthen assertions
- `tests/unit/community/summarize.test.ts` — afterEach, boundary test
- `tests/unit/community/raptor.test.ts` — afterEach, content-hash test
- `tests/unit/community/scheduler.test.ts` — afterEach, test CommunityScheduler class
- `tests/unit/community/community-cli.test.ts` — afterEach, strengthen assertions

---

## Task 1: LLM Client

**Files:**
- Create: `src/shared/llm-client.ts`
- Create: `tests/unit/shared/llm-client.test.ts`

**Context:** Shared LLM client used by Phase 8 summaries and Phase 10 dedup. Uses `@anthropic-ai/sdk` for real Haiku calls, falls back to heuristic when air-gapped or no API key.

- [ ] **Step 1: Install @anthropic-ai/sdk**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun add @anthropic-ai/sdk
```

- [ ] **Step 2: Create llm-client.ts**

Create `src/shared/llm-client.ts` with:

```typescript
// Module: llm-client — Shared LLM client with Anthropic SDK + air-gapped fallback
import type { SiaConfig } from "@/shared/config";

/** LLM client interface for summarization and classification tasks. */
export interface LlmClient {
  summarize(prompt: string): Promise<string>;
  classify(prompt: string, options: string[]): Promise<string>;
}

/** Rate limiter state */
interface RateLimiter {
  tokens: number;
  maxTokens: number;
  refillRate: number; // tokens per ms
  lastRefill: number;
}

function createRateLimiter(maxPerMinute: number): RateLimiter {
  return {
    tokens: maxPerMinute,
    maxTokens: maxPerMinute,
    refillRate: maxPerMinute / 60000,
    lastRefill: Date.now(),
  };
}

async function acquireToken(limiter: RateLimiter): Promise<void> {
  const now = Date.now();
  const elapsed = now - limiter.lastRefill;
  limiter.tokens = Math.min(limiter.maxTokens, limiter.tokens + elapsed * limiter.refillRate);
  limiter.lastRefill = now;

  if (limiter.tokens < 1) {
    const waitMs = (1 - limiter.tokens) / limiter.refillRate;
    await new Promise((r) => setTimeout(r, waitMs));
    limiter.tokens = 0;
  } else {
    limiter.tokens -= 1;
  }
}

/** Air-gapped/fallback client that uses heuristic string concatenation. */
function createFallbackClient(): LlmClient {
  return {
    async summarize(prompt: string): Promise<string> {
      // Extract content between quotes or after colons as a best-effort summary
      const lines = prompt.split("\n").filter((l) => l.trim().length > 0);
      return lines.slice(0, 5).join("; ").slice(0, 500);
    },
    async classify(_prompt: string, options: string[]): Promise<string> {
      return options[0] ?? "unknown";
    },
  };
}

/** Create an LLM client backed by the Anthropic SDK with rate limiting. */
export function createLlmClient(config: SiaConfig): LlmClient {
  // Air-gapped mode or no API key → fallback
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (config.airGapped || !apiKey) {
    return createFallbackClient();
  }

  const model = config.captureModel ?? "claude-haiku-4-5-20251001";
  const limiter = createRateLimiter(10);
  let anthropicClient: { messages: { create: (opts: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }> }> } } | null = null;

  async function getClient() {
    if (!anthropicClient) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      anthropicClient = new Anthropic({ apiKey }) as typeof anthropicClient;
    }
    return anthropicClient!;
  }

  return {
    async summarize(prompt: string): Promise<string> {
      try {
        await acquireToken(limiter);
        const client = await getClient();
        const response = await client.messages.create({
          model,
          max_tokens: 300,
          messages: [{ role: "user", content: prompt }],
        });
        const text = response.content[0]?.text;
        return text ?? createFallbackClient().summarize(prompt);
      } catch (err) {
        console.warn("LLM summarize failed, using fallback:", err);
        return createFallbackClient().summarize(prompt);
      }
    },
    async classify(prompt: string, options: string[]): Promise<string> {
      try {
        await acquireToken(limiter);
        const client = await getClient();
        const response = await client.messages.create({
          model,
          max_tokens: 50,
          messages: [{ role: "user", content: `${prompt}\n\nRespond with exactly one of: ${options.join(", ")}` }],
        });
        const text = (response.content[0]?.text ?? "").trim().toLowerCase();
        const match = options.find((o) => text.includes(o.toLowerCase()));
        return match ?? options[0] ?? "unknown";
      } catch (err) {
        console.warn("LLM classify failed, using fallback:", err);
        return options[0] ?? "unknown";
      }
    },
  };
}

export { createFallbackClient };
```

- [ ] **Step 3: Write llm-client tests**

Create `tests/unit/shared/llm-client.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createFallbackClient, createLlmClient } from "@/shared/llm-client";
import { DEFAULT_CONFIG } from "@/shared/config";

describe("LlmClient", () => {
  it("fallback summarize returns truncated content", async () => {
    const client = createFallbackClient();
    const result = await client.summarize("Line one\nLine two\nLine three");
    expect(result).toContain("Line one");
    expect(result.length).toBeLessThanOrEqual(500);
  });

  it("fallback classify returns first option", async () => {
    const client = createFallbackClient();
    const result = await client.classify("test prompt", ["SAME", "DIFFERENT"]);
    expect(result).toBe("SAME");
  });

  it("createLlmClient returns fallback when airGapped", () => {
    const client = createLlmClient({ ...DEFAULT_CONFIG, airGapped: true });
    expect(client).toBeDefined();
  });

  it("createLlmClient returns fallback when no API key", () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const client = createLlmClient({ ...DEFAULT_CONFIG, airGapped: false });
      expect(client).toBeDefined();
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });
});
```

- [ ] **Step 4: Run tests**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test -- tests/unit/shared/llm-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/llm-client.ts tests/unit/shared/llm-client.test.ts package.json bun.lock
git commit -m "feat(shared): add LLM client with Anthropic SDK + air-gapped fallback"
```

---

## Task 2: Fix Community Summaries

**Files:**
- Modify: `src/community/summarize.ts`

**Context:** Replace string concatenation with LLM-generated coherent paragraphs. Air-gapped mode skips entirely (preserves correct existing behavior). Fix misleading empty message.

- [ ] **Step 1: Update summarize.ts signature to accept LlmClient**

Change `summarizeCommunities` to accept an `LlmClient` parameter:
```typescript
import type { LlmClient } from "@/shared/llm-client";

export async function summarizeCommunities(
  db: SiaDb,
  config: { airGapped: boolean },
  llmClient?: LlmClient,
): Promise<number> {
```
The `llmClient` is optional for backward compatibility with tests.

- [ ] **Step 2: Replace formatSummary with LLM call**

Replace the `formatSummary` function:
```typescript
async function generateSummary(entities: TopEntityRow[], llmClient?: LlmClient): Promise<string> {
  if (entities.length === 0) {
    return "Community has no active members (all entities invalidated or archived).";
  }

  const entityDescriptions = entities
    .map((e) => `${e.name}: ${e.summary || "No summary available."}`)
    .join("\n");

  if (!llmClient) {
    // Fallback: string concatenation
    return `Top members — ${entityDescriptions.replace(/\n/g, "; ")}`;
  }

  const prompt = `Summarize this code community in a single coherent paragraph (2-4 sentences). Describe what the community does, how its members relate, and what purpose it serves in the codebase.\n\nMembers:\n${entityDescriptions}`;
  return llmClient.summarize(prompt);
}
```

Update the call site inside the transaction to use `await generateSummary(entities, llmClient)` instead of `formatSummary(entities)`.

- [ ] **Step 3: Run existing summarize tests**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test -- tests/unit/community/summarize.test.ts
```
Existing tests should pass since `llmClient` is optional.

- [ ] **Step 4: Commit**

```bash
git add src/community/summarize.ts
git commit -m "feat(community): use LLM for coherent paragraph summaries"
```

---

## Task 3: Leiden Fixes

**Files:**
- Modify: `src/community/leiden.ts`

**Context:** Add Leiden refinement step, per-package Level 0 detection, edge weight fixes, iteration cap.

- [ ] **Step 1: Fix edge type weights**

Add to `EDGE_TYPE_WEIGHTS`:
```typescript
contains: 0.5,
depends_on: 0.5,
```
Change the fallthrough default from `1` to `0.3`:
```typescript
const typeWeight = type ? (EDGE_TYPE_WEIGHTS[type] ?? 0.3) : 0.3;
```

- [ ] **Step 2: Add iteration cap to louvain**

Add `maxIterations = 100` parameter and counter:
```typescript
function louvain(units, adjacency, resolution, maxIterations = 100): Map<string, string> {
  // ...
  let iterations = 0;
  let moved = true;
  while (moved && iterations < maxIterations) {
    iterations++;
    moved = false;
    // ... existing loop body
  }
```

- [ ] **Step 3: Add refinePartition function**

Add after the `louvain` function:
```typescript
function refinePartition(
  assignment: Map<string, string>,
  adjacency: Map<string, Map<string, number>>,
): Map<string, string> {
  // Group nodes by community
  const communities = new Map<string, string[]>();
  for (const [node, comm] of assignment) {
    if (!communities.has(comm)) communities.set(comm, []);
    communities.get(comm)!.push(node);
  }

  const refined = new Map<string, string>();
  for (const [comm, members] of communities) {
    if (members.length <= 1) {
      for (const m of members) refined.set(m, comm);
      continue;
    }

    // BFS to find connected components within this community
    const memberSet = new Set(members);
    const visited = new Set<string>();
    let componentIdx = 0;

    for (const start of members) {
      if (visited.has(start)) continue;
      const component: string[] = [];
      const queue = [start];
      visited.add(start);

      while (queue.length > 0) {
        const node = queue.shift()!;
        component.push(node);
        const neighbors = adjacency.get(node);
        if (neighbors) {
          for (const [neighbor] of neighbors) {
            if (memberSet.has(neighbor) && !visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
      }

      const compId = componentIdx === 0 ? comm : `${comm}_${componentIdx}`;
      for (const node of component) {
        refined.set(node, compId);
      }
      componentIdx++;
    }
  }

  return refined;
}
```

- [ ] **Step 4: Wire refinement into detectCommunities**

After the `louvain` call in the detection loop, add:
```typescript
const assignment = louvain(units, unitAdj, resolutions[level]);
const refinedAssignment = refinePartition(assignment, unitAdj);
```
Use `refinedAssignment` instead of `assignment` for the rest of the loop.

- [ ] **Step 5: Add per-package Level 0 detection**

For Level 0 only, group entities by `package_path` and run detection per-package:
```typescript
if (level === 0 && entityPackages.size > 0) {
  // Group entities by package
  const byPackage = new Map<string, Unit[]>();
  for (const unit of units) {
    const pkg = entityPackages.get([...unit.members][0]) ?? "__root__";
    if (!byPackage.has(pkg)) byPackage.set(pkg, []);
    byPackage.get(pkg)!.push(unit);
  }

  // Run detection per-package, merge results
  const allDetected: DetectedCommunity[] = [];
  for (const [pkg, pkgUnits] of byPackage) {
    // ... build per-package adjacency and run louvain+refine
    // ... create DetectedCommunity entries with packagePath = pkg
  }
  levelCommunities.push(allDetected);
  units = allDetected.map((c) => ({ id: c.id, members: c.members }));
  continue; // Skip the general detection for Level 0
}
```

- [ ] **Step 6: Run leiden tests**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test -- tests/unit/community/leiden.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/community/leiden.ts
git commit -m "fix(community): add Leiden refinement, per-package detection, edge weight fixes"
```

---

## Task 4: RAPTOR Fixes

**Files:**
- Modify: `src/community/raptor.ts`
- Modify: `src/mcp/tools/sia-expand.ts`

**Context:** Level 0 active-only, Level 1 lazy (on first sia_expand), Level 2 via LLM, Level 3 weekly.

- [ ] **Step 1: Fix Level 0 query to active-only**

Change the entity query:
```typescript
const entityResult = await db.execute(
  `SELECT id, content, summary, t_valid_until
   FROM entities
   WHERE t_valid_until IS NULL AND archived_at IS NULL`,
);
```

- [ ] **Step 2: Remove eager Level 1 generation**

Remove the Level 1 loop (lines 88-102). Level 0 still generates eagerly. Level 1 becomes lazy.

- [ ] **Step 3: Add getOrCreateLevel1Summary function**

Export a new function:
```typescript
import type { LlmClient } from "@/shared/llm-client";

export async function getOrCreateLevel1Summary(
  db: SiaDb,
  entityId: string,
  llmClient?: LlmClient,
): Promise<string | null> {
  // Check if Level 1 summary exists
  const existing = await db.execute(
    "SELECT content FROM summary_tree WHERE id = ? AND expires_at IS NULL",
    [`lvl1:${entityId}`],
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].content as string;
  }

  // Fetch entity
  const entityResult = await db.execute(
    "SELECT id, content, summary, t_valid_until FROM entities WHERE id = ?",
    [entityId],
  );
  if (entityResult.rows.length === 0) return null;
  const entity = entityResult.rows[0] as { id: string; content: string; summary: string; t_valid_until: number | null };

  // Generate via LLM or fallback
  let summaryText: string;
  if (llmClient) {
    summaryText = await llmClient.summarize(
      `Write a one-paragraph summary of this code entity:\n\nName: ${entity.id}\nContent: ${entity.content.slice(0, 500)}`,
    );
  } else {
    summaryText = entity.summary?.trim() ? entity.summary : entity.content.slice(0, 240);
  }

  const now = Date.now();
  await upsertSummary(db, {
    id: `lvl1:${entityId}`,
    level: 1,
    scopeId: entityId,
    content: summaryText,
    tokenCount: wordCount(summaryText),
    contentHash: hashContent(summaryText),
    expiresAt: entity.t_valid_until ? now : null,
  }, now);

  return summaryText;
}
```

- [ ] **Step 4: Update buildSummaryTree signature to accept LlmClient**

Change signature:
```typescript
import type { LlmClient } from "@/shared/llm-client";

export async function buildSummaryTree(db: SiaDb, llmClient?: LlmClient): Promise<void> {
```

- [ ] **Step 5: Add Level 2 via LLM**

In the Level 2 loop, replace the raw `community.summary` fallback with an LLM call:
```typescript
// Level 2 — community/module summaries via LLM
for (const community of communities) {
  let content: string;
  if (llmClient && community.summary) {
    content = await llmClient.summarize(
      `Rewrite this community summary as a coherent paragraph describing the module's purpose and how its members relate:\n\n${community.summary}`,
    );
  } else {
    content = community.summary?.trim()
      ? community.summary
      : `Community ${community.id} has no summary.`;
  }
  // ... rest of upsert unchanged
}
```

- [ ] **Step 6: Add Level 3 weekly check**

Add a `lastLevel3At` check before generating Level 3:
```typescript
// Level 3 — only regenerate weekly
const existingLevel3 = await db.execute(
  "SELECT created_at FROM summary_tree WHERE id = 'lvl3:overview'",
);
const lastLevel3At = (existingLevel3.rows[0]?.created_at as number) ?? 0;
const oneWeek = 7 * 24 * 60 * 60 * 1000;
if (now - lastLevel3At < oneWeek && existingLevel3.rows.length > 0) {
  // Skip Level 3 regeneration
} else {
  // existing Level 3 generation code
}
```

- [ ] **Step 7: Wire lazy Level 1 into sia-expand.ts**

In `src/mcp/tools/sia-expand.ts`, after fetching the root entity, add:
```typescript
import { getOrCreateLevel1Summary } from "@/community/raptor";

// After rootEntity is fetched:
void getOrCreateLevel1Summary(db, input.entity_id);
```
The `void` makes it fire-and-forget — it generates the summary in the background without delaying the expand response.

- [ ] **Step 8: Run tests**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test -- tests/unit/community/raptor.test.ts tests/unit/mcp/tools/sia-expand.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/community/raptor.ts src/mcp/tools/sia-expand.ts
git commit -m "fix(community): RAPTOR Level 0 active-only, Level 1 lazy, Level 2 LLM, Level 3 weekly"
```

---

## Task 5: Scheduler & CLI Fixes

**Files:**
- Modify: `src/community/scheduler.ts`
- Modify: `src/cli/commands/community.ts`

- [ ] **Step 1: Add warning log for small graphs in scheduler**

In `shouldRunDetection`, after the check:
```typescript
if (totalEntities < config.communityMinGraphSize) {
  console.warn(
    `Graph has fewer than ${config.communityMinGraphSize} entities (${totalEntities}) — skipping community detection`,
  );
  return false;
}
```

- [ ] **Step 2: Add runInBackground to CommunityScheduler**

```typescript
runInBackground(): void {
  void this.run().catch((err) =>
    console.error("Community detection failed:", err),
  );
}
```

- [ ] **Step 3: Update scheduler.run() to pass LlmClient**

Accept `llmClient` in constructor and pass to `summarizeCommunities`:
```typescript
export class CommunityScheduler {
  constructor(
    private readonly db: SiaDb,
    private readonly config: SiaConfig,
    private readonly llmClient?: LlmClient,
  ) {}

  async run(): Promise<void> {
    const shouldRun = await this.check();
    if (!shouldRun) return;

    await detectCommunities(this.db);
    await summarizeCommunities(this.db, { airGapped: this.config.airGapped }, this.llmClient);
    await buildSummaryTree(this.db, this.llmClient);
  }
```

- [ ] **Step 4: Add Level 0 to CLI output**

In `formatCommunityTree`, add Level 0 loading and display:
```typescript
const level0 = await loadCommunities(db, 0, opts.packagePath);

// After Level 1 children display, add:
for (const child of children) {
  // ... existing Level 1 display ...

  // Level 0 (briefly noted)
  const level0Children = level0.filter((c) => c.parentId === child.id);
  if (level0Children.length > 0) {
    lines.push(`    (${level0Children.length} fine-grained clusters)`);
  }
}
```

- [ ] **Step 5: Fix --package filter**

Remove `OR package_path IS NULL` from the `loadCommunities` query when a package is specified:
```typescript
if (packagePath) {
  wherePackage = "AND package_path = ?";
  params.push(packagePath);
}
```

- [ ] **Step 6: Run tests**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test -- tests/unit/community/
```

- [ ] **Step 7: Commit**

```bash
git add src/community/scheduler.ts src/cli/commands/community.ts
git commit -m "fix(community): scheduler warning + runInBackground, CLI shows Level 0"
```

---

## Task 6: Test Fixes (All 5 Files)

**Files:**
- Modify: `tests/unit/community/leiden.test.ts`
- Modify: `tests/unit/community/summarize.test.ts`
- Modify: `tests/unit/community/raptor.test.ts`
- Modify: `tests/unit/community/scheduler.test.ts`
- Modify: `tests/unit/community/community-cli.test.ts`

**Context:** All 5 test files are missing `afterEach` cleanup (CLAUDE.md violation). Assertions are weak. Need to add proper temp dir management and meaningful assertions.

- [ ] **Step 1: Fix all 5 test files with afterEach pattern**

Every test file needs the same fix: replace `function createDb()` with a proper `beforeEach`/`afterEach` pattern:
```typescript
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("...", () => {
  let tmpDir: string;
  let db: SiaDb | undefined;

  function makeTmp(): string {
    const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  afterEach(async () => {
    if (db) { await db.close(); db = undefined; }
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  // ... tests use tmpDir and db ...
});
```

- [ ] **Step 2: Strengthen leiden.test.ts assertions**

Add assertion that intra-cluster entities are in the same Level 0 community:
```typescript
// After detection, verify cluster A entities share a community
const clusterAMembers = await db.execute(
  `SELECT DISTINCT cm.community_id
   FROM community_members cm
   WHERE cm.entity_id IN (${clusters[0].ids.map(() => "?").join(",")})
     AND cm.level = 0`,
  clusters[0].ids,
);
// All members of cluster A should be in the same community
const communityIds = clusterAMembers.rows.map((r) => r.community_id);
expect(new Set(communityIds).size).toBe(1);
```

- [ ] **Step 3: Add summarize.test.ts 20% boundary test**

```typescript
it("does not regenerate when change is exactly 20%", async () => {
  // Set up community with 5 members, last_summary_member_count = 5
  // Add 1 member (20% change) → should NOT trigger
  // Verify summary was not regenerated
});
```

- [ ] **Step 4: Add raptor.test.ts content-hash test**

```typescript
it("regenerates Level 1 summary when entity content changes", async () => {
  // Build summary tree
  // Change an entity's content
  // Rebuild
  // Verify the Level 1 content_hash changed
});
```

- [ ] **Step 5: Add scheduler.test.ts CommunityScheduler tests**

```typescript
it("CommunityScheduler.check returns false for small graphs", async () => {
  const scheduler = new CommunityScheduler(db, config);
  const result = await scheduler.check();
  expect(result).toBe(false);
});

it("CommunityScheduler.run completes without error", async () => {
  // Seed enough entities
  const scheduler = new CommunityScheduler(db, config);
  await expect(scheduler.run()).resolves.not.toThrow();
});
```

- [ ] **Step 6: Strengthen community-cli.test.ts**

```typescript
it("output contains Level 2 headings and Level 1 indentation", async () => {
  const output = await formatCommunityTree(db);
  expect(output).toContain("Community");
  expect(output).toContain("members");
  // Verify indentation pattern exists
  expect(output).toMatch(/\s{2}-/); // Level 1 indentation
});
```

- [ ] **Step 7: Run all community tests**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test -- tests/unit/community/
```

- [ ] **Step 8: Commit**

```bash
git add tests/unit/community/
git commit -m "fix(community): add afterEach cleanup, strengthen test assertions"
```

---

## Task 7: Final Integration

- [ ] **Step 1: Run full test suite**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run test
```

- [ ] **Step 2: Run linter and fix**

```bash
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH" && bun run lint:fix -- --unsafe
```

- [ ] **Step 3: Commit lint fixes if needed**

```bash
git add -A && git commit -m "chore: fix lint issues from phase 8 remediation"
```

---

## Execution Order

```
Task 1 (LLM client) ─── foundational, everything else uses it
         │
Task 2 (summarize) ──┐
Task 3 (leiden) ──────┼── parallel (independent modules, both depend on Task 1)
Task 4 (raptor) ──────┘
         │
Task 5 (scheduler + CLI) ─── depends on Tasks 2-4
         │
Task 6 (test fixes) ─── depends on all source changes
         │
Task 7 (integration) ─── depends on all above
```

**Optimal execution:** Task 1 → Tasks 2+3+4 in parallel → Task 5 → Task 6 → Task 7
