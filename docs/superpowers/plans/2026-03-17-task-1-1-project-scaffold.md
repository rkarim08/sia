# Task 1.1 — Project Scaffold and Tooling

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize the Sia repository with Bun runtime, TypeScript strict mode, full directory tree from ARCHI §10, Biome linting, Vitest testing, and agent behavioral templates — so that `bun run test`, `bun run lint`, and `npx sia --version` all pass.

**Architecture:** Bun monorepo-style project with path aliases (`@/graph`, `@/capture`, etc.) pointing into `src/`. Vitest with two separate configs for unit and integration tests. Biome for formatting and linting. CLI entry point at `src/cli/index.ts` registered as `sia` binary in package.json. Agent behavioral templates copied from `plans/` into `src/agent/` with template variable stubs.

**Tech Stack:** Bun 1.x, TypeScript 5.x (strict), Biome, Vitest, SQLite (dependencies installed but not wired yet)

---

## File Map

### New files to create

**Root config files:**
- `package.json` — Bun project, scripts, binary entry, dependencies
- `tsconfig.json` — strict mode, path aliases
- `biome.json` — linting and formatting rules
- `vitest.config.ts` — unit test config
- `vitest.integration.config.ts` — integration test config

**CLI entry point:**
- `src/cli/index.ts` — minimal CLI that prints version

**Stub files (empty exports, one per ARCHI §10 file):**
- `src/graph/*.ts` — 13 files
- `src/workspace/*.ts` — 4 files
- `src/capture/*.ts` + `src/capture/prompts/*.ts` — 14 files
- `src/ast/*.ts` + `src/ast/extractors/*.ts` — 10 files
- `src/community/*.ts` — 4 files
- `src/retrieval/*.ts` — 9 files
- `src/mcp/*.ts` + `src/mcp/tools/*.ts` — 7 files
- `src/security/*.ts` — 5 files
- `src/sync/*.ts` — 7 files
- `src/decay/*.ts` — 5 files
- `src/cli/commands/*.ts` — 17 files
- `src/shared/*.ts` — 4 files (config, logger, errors, types)

**Migration stubs:**
- `migrations/meta/.gitkeep`
- `migrations/bridge/.gitkeep`
- `migrations/semantic/.gitkeep`
- `migrations/episodic/.gitkeep`

**Agent templates:**
- `src/agent/claude-md-template.md` — from `plans/SIA_CLAUDE_MD.md`
- `src/agent/claude-md-template-flagging.md` — variant with flagging section
- `src/agent/modules/sia-orientation.md` — from `plans/sia-orientation.md`
- `src/agent/modules/sia-feature.md` — from `plans/sia-feature.md`
- `src/agent/modules/sia-regression.md` — from `plans/sia-regression.md`
- `src/agent/modules/sia-review.md` — from `plans/sia-review.md`
- `src/agent/modules/sia-flagging.md` — from `plans/sia-flagging.md`
- `src/agent/modules/sia-tools.md` — from `plans/sia-tools.md`

**Test files:**
- `tests/unit/scaffold.test.ts` — validates scaffold structure
- `tests/integration/.gitkeep`

---

## Task 1: Install Bun

- [ ] **Step 1: Install Bun runtime**

Run:
```bash
curl -fsSL https://bun.sh/install | bash
```

- [ ] **Step 2: Verify Bun is available**

Run: `bun --version`
Expected: `1.x.x` (any 1.x version)

---

## Task 2: Initialize project with package.json

- [ ] **Step 1: Create package.json**

Create: `package.json`

```json
{
  "name": "sia",
  "version": "0.1.0",
  "description": "Persistent graph memory for AI coding agents",
  "type": "module",
  "bin": {
    "sia": "./src/cli/index.ts"
  },
  "scripts": {
    "test": "vitest run --config vitest.config.ts",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:watch": "vitest --config vitest.config.ts",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

- [ ] **Step 2: Install core dev dependencies**

Run:
```bash
bun add -d typescript @biomejs/biome vitest @types/bun
```

- [ ] **Step 3: Install runtime dependencies (stubs for now)**

Run:
```bash
bun add uuid
bun add -d @types/uuid
```

- [ ] **Step 4: Verify package.json and bun.lock created**

Run: `ls package.json bun.lock`
Expected: both files listed

---

## Task 3: TypeScript configuration with path aliases

- [ ] **Step 1: Create tsconfig.json**

Create: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": ".",
    "types": ["bun-types"],
    "paths": {
      "@/graph/*": ["./src/graph/*"],
      "@/workspace/*": ["./src/workspace/*"],
      "@/capture/*": ["./src/capture/*"],
      "@/ast/*": ["./src/ast/*"],
      "@/community/*": ["./src/community/*"],
      "@/retrieval/*": ["./src/retrieval/*"],
      "@/mcp/*": ["./src/mcp/*"],
      "@/security/*": ["./src/security/*"],
      "@/sync/*": ["./src/sync/*"],
      "@/decay/*": ["./src/decay/*"],
      "@/cli/*": ["./src/cli/*"],
      "@/shared/*": ["./src/shared/*"],
      "@/agent/*": ["./src/agent/*"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2: Verify TypeScript config is valid**

Run: `bunx tsc --noEmit --showConfig | head -5`
Expected: prints valid config JSON without errors

---

## Task 4: Biome configuration

- [ ] **Step 1: Create biome.json**

Create: `biome.json`

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "warn",
        "noUnusedImports": "warn"
      },
      "style": {
        "noNonNullAssertion": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "lineWidth": 100
  },
  "files": {
    "ignore": [
      "node_modules",
      "dist",
      "*.md",
      "migrations/**/*.sql",
      "src/agent/**/*.md"
    ]
  }
}
```

- [ ] **Step 2: Verify Biome config is valid**

Run: `bunx biome check .`
Expected: exits 0 (no errors on empty project)

---

## Task 5: Vitest configuration

- [ ] **Step 1: Create vitest.config.ts (unit tests)**

Create: `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	test: {
		include: ["tests/unit/**/*.test.ts"],
		globals: true,
	},
	resolve: {
		alias: {
			"@/graph": resolve(__dirname, "src/graph"),
			"@/workspace": resolve(__dirname, "src/workspace"),
			"@/capture": resolve(__dirname, "src/capture"),
			"@/ast": resolve(__dirname, "src/ast"),
			"@/community": resolve(__dirname, "src/community"),
			"@/retrieval": resolve(__dirname, "src/retrieval"),
			"@/mcp": resolve(__dirname, "src/mcp"),
			"@/security": resolve(__dirname, "src/security"),
			"@/sync": resolve(__dirname, "src/sync"),
			"@/decay": resolve(__dirname, "src/decay"),
			"@/cli": resolve(__dirname, "src/cli"),
			"@/shared": resolve(__dirname, "src/shared"),
			"@/agent": resolve(__dirname, "src/agent"),
		},
	},
});
```

- [ ] **Step 2: Create vitest.integration.config.ts**

Create: `vitest.integration.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	test: {
		include: ["tests/integration/**/*.test.ts"],
		globals: true,
		testTimeout: 30_000,
	},
	resolve: {
		alias: {
			"@/graph": resolve(__dirname, "src/graph"),
			"@/workspace": resolve(__dirname, "src/workspace"),
			"@/capture": resolve(__dirname, "src/capture"),
			"@/ast": resolve(__dirname, "src/ast"),
			"@/community": resolve(__dirname, "src/community"),
			"@/retrieval": resolve(__dirname, "src/retrieval"),
			"@/mcp": resolve(__dirname, "src/mcp"),
			"@/security": resolve(__dirname, "src/security"),
			"@/sync": resolve(__dirname, "src/sync"),
			"@/decay": resolve(__dirname, "src/decay"),
			"@/cli": resolve(__dirname, "src/cli"),
			"@/shared": resolve(__dirname, "src/shared"),
			"@/agent": resolve(__dirname, "src/agent"),
		},
	},
});
```

---

## Task 6: Create full directory tree (ARCHI §10)

- [ ] **Step 1: Create all source directories**

Run:
```bash
mkdir -p src/graph src/workspace src/capture/prompts src/ast/extractors src/community src/retrieval src/mcp/tools src/security src/sync src/decay src/cli/commands src/shared src/agent/modules
```

- [ ] **Step 2: Create migration directories**

Run:
```bash
mkdir -p migrations/meta migrations/bridge migrations/semantic migrations/episodic
```

- [ ] **Step 3: Create test directories**

Run:
```bash
mkdir -p tests/unit tests/integration
```

- [ ] **Step 4: Create gitkeep files for empty dirs**

Run:
```bash
touch migrations/meta/.gitkeep migrations/bridge/.gitkeep migrations/semantic/.gitkeep migrations/episodic/.gitkeep tests/integration/.gitkeep
```

---

## Task 7: Create stub files for all ARCHI §10 modules

Each stub exports nothing but is a valid TypeScript file. This ensures the directory structure is committed and path aliases resolve.

- [ ] **Step 1: Create src/graph stubs**

Create each of these files with content `// Module: [name] — implementation in Phase 1\nexport {};\n`:

- `src/graph/db-interface.ts` — SiaDb adapter (bun:sqlite + @libsql/client)
- `src/graph/meta-db.ts` — meta.db CRUD
- `src/graph/bridge-db.ts` — bridge.db cross-repo edge CRUD
- `src/graph/semantic-db.ts` — graph.db migration runner + open
- `src/graph/episodic-db.ts` — episodic.db connection + open
- `src/graph/entities.ts` — entity CRUD incl. invalidateEntity()
- `src/graph/edges.ts` — edge CRUD incl. invalidateEdge()
- `src/graph/communities.ts` — community + summary tree CRUD
- `src/graph/staging.ts` — staging area CRUD
- `src/graph/flags.ts` — session flags CRUD
- `src/graph/audit.ts` — audit log (append-only)
- `src/graph/snapshots.ts` — snapshot create + restore
- `src/graph/types.ts` — all TypeScript types

- [ ] **Step 2: Create src/workspace stubs**

- `src/workspace/detector.ts` — monorepo auto-detection
- `src/workspace/manifest.ts` — .sia-manifest.yaml parser
- `src/workspace/api-contracts.ts` — API contract auto-detector
- `src/workspace/cross-repo.ts` — bridge.db helpers + ATTACH/DETACH

- [ ] **Step 3: Create src/capture stubs**

- `src/capture/pipeline.ts` — main orchestration
- `src/capture/hook.ts` — Claude Code hook entry point
- `src/capture/chunker.ts` — transcript chunking + trust tier
- `src/capture/track-a-ast.ts` — Tree-sitter extraction
- `src/capture/track-b-llm.ts` — LLM semantic extraction
- `src/capture/consolidate.ts` — two-phase consolidation
- `src/capture/edge-inferrer.ts` — edge inference
- `src/capture/flag-processor.ts` — session flag processing
- `src/capture/embedder.ts` — ONNX local embedder
- `src/capture/tokenizer.ts` — word-piece tokenizer
- `src/capture/prompts/extract.ts` — extraction prompt
- `src/capture/prompts/consolidate.ts` — consolidation prompt
- `src/capture/prompts/extract-flagged.ts` — flagged extraction prompt
- `src/capture/prompts/edge-infer.ts` — edge inference prompt

- [ ] **Step 4: Create src/ast stubs**

- `src/ast/languages.ts` — LANGUAGE_REGISTRY
- `src/ast/indexer.ts` — full-repo + incremental indexer
- `src/ast/watcher.ts` — chokidar file watcher
- `src/ast/pagerank-builder.ts` — PersonalizedPageRank
- `src/ast/extractors/tier-a.ts` — generic Tier A extraction
- `src/ast/extractors/tier-b.ts` — Tier B extraction
- `src/ast/extractors/c-include.ts` — C/C++ include resolution
- `src/ast/extractors/csharp-project.ts` — C# .csproj extraction
- `src/ast/extractors/sql-schema.ts` — SQL schema extraction
- `src/ast/extractors/project-manifest.ts` — Cargo.toml, go.mod, etc.

- [ ] **Step 5: Create src/community stubs**

- `src/community/leiden.ts`
- `src/community/summarize.ts`
- `src/community/raptor.ts`
- `src/community/scheduler.ts`

- [ ] **Step 6: Create src/retrieval stubs**

- `src/retrieval/search.ts` — three-stage pipeline orchestration
- `src/retrieval/vector-search.ts` — sqlite-vss two-stage retrieval
- `src/retrieval/bm25-search.ts` — FTS5 keyword search
- `src/retrieval/graph-traversal.ts` — BFS + 1-hop expansion
- `src/retrieval/workspace-search.ts` — async cross-repo retrieval
- `src/retrieval/pagerank.ts`
- `src/retrieval/reranker.ts` — RRF + trust-weighted scoring
- `src/retrieval/query-classifier.ts`
- `src/retrieval/context-assembly.ts`

- [ ] **Step 7: Create src/mcp stubs**

- `src/mcp/server.ts`
- `src/mcp/tools/sia-search.ts`
- `src/mcp/tools/sia-by-file.ts`
- `src/mcp/tools/sia-expand.ts`
- `src/mcp/tools/sia-community.ts`
- `src/mcp/tools/sia-at-time.ts`
- `src/mcp/tools/sia-flag.ts`

- [ ] **Step 8: Create src/security stubs**

- `src/security/pattern-detector.ts`
- `src/security/semantic-consistency.ts`
- `src/security/staging-promoter.ts`
- `src/security/rule-of-two.ts`
- `src/security/sanitize.ts`

- [ ] **Step 9: Create src/sync stubs**

- `src/sync/hlc.ts`
- `src/sync/keychain.ts`
- `src/sync/client.ts`
- `src/sync/push.ts`
- `src/sync/pull.ts`
- `src/sync/conflict.ts`
- `src/sync/dedup.ts`

- [ ] **Step 10: Create src/decay stubs**

- `src/decay/decay.ts`
- `src/decay/archiver.ts`
- `src/decay/consolidation-sweep.ts`
- `src/decay/episodic-promoter.ts`
- `src/decay/scheduler.ts`

- [ ] **Step 11: Create src/shared stubs**

- `src/shared/config.ts`
- `src/shared/logger.ts`
- `src/shared/errors.ts`
- `src/shared/types.ts` — shared cross-module types

- [ ] **Step 12: Create src/cli/commands stubs**

- `src/cli/commands/install.ts`
- `src/cli/commands/workspace.ts`
- `src/cli/commands/server.ts`
- `src/cli/commands/team.ts`
- `src/cli/commands/share.ts`
- `src/cli/commands/conflicts.ts`
- `src/cli/commands/search.ts`
- `src/cli/commands/stats.ts`
- `src/cli/commands/prune.ts`
- `src/cli/commands/export.ts`
- `src/cli/commands/import.ts`
- `src/cli/commands/rollback.ts`
- `src/cli/commands/reindex.ts`
- `src/cli/commands/community.ts`
- `src/cli/commands/download-model.ts`
- `src/cli/commands/enable-flagging.ts`
- `src/cli/commands/disable-flagging.ts`

---

## Task 8: Create CLI entry point

- [ ] **Step 1: Write src/cli/index.ts**

Create: `src/cli/index.ts`

```typescript
#!/usr/bin/env bun

const VERSION = "0.1.0";

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
	console.log(`sia v${VERSION}`);
	process.exit(0);
}

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
	console.log(`sia v${VERSION} — Persistent graph memory for AI coding agents

Usage:
  sia <command> [options]

Commands:
  install              Install Sia in the current project
  workspace            Manage workspaces (create, list, add, remove, show)
  team                 Team sync (join, leave, status)
  search               Search the knowledge graph
  stats                Show graph statistics
  reindex              Re-index the repository
  community            Show community structure
  prune                Remove archived entities
  export               Export graph to JSON
  import               Import graph from JSON
  rollback             Restore graph from snapshot
  download-model       Download ONNX embedding model
  enable-flagging      Enable mid-session flagging
  disable-flagging     Disable mid-session flagging

Options:
  --version, -v        Show version
  --help, -h           Show this help
`);
	process.exit(0);
}

console.error(`Unknown command: ${args[0]}. Run 'sia --help' for usage.`);
process.exit(1);
```

- [ ] **Step 2: Make CLI executable**

Run: `chmod +x src/cli/index.ts`

- [ ] **Step 3: Verify CLI works**

Run: `bun src/cli/index.ts --version`
Expected: `sia v0.1.0`

Run: `bun src/cli/index.ts --help`
Expected: help text with command list

Run: `bun src/cli/index.ts bogus`
Expected: exit code 1, `Unknown command: bogus`

---

## Task 9: Copy agent behavioral templates

- [ ] **Step 1: Copy base template from plans/SIA_CLAUDE_MD.md**

Copy the contents of `plans/SIA_CLAUDE_MD.md` to `src/agent/claude-md-template.md`, adding template variable markers at the top:

```markdown
<!-- Sia v{{SIA_VERSION}} — Generated {{GENERATED_AT}} -->
<!-- Workspace: {{WORKSPACE_NAME}} -->
```

Followed by the full content of `plans/SIA_CLAUDE_MD.md` starting from the `# Sia — Agent Behavioral Specification` heading.

- [ ] **Step 2: Create flagging-enabled variant**

Copy `src/agent/claude-md-template.md` to `src/agent/claude-md-template-flagging.md`. This is the same content but will include the `sia_flag` section when the feature is implemented. For now, identical to the base template.

- [ ] **Step 3: Copy contextual playbook modules**

Copy these files from `plans/` into `src/agent/modules/`:
- `plans/sia-orientation.md` → `src/agent/modules/sia-orientation.md`
- `plans/sia-feature.md` → `src/agent/modules/sia-feature.md`
- `plans/sia-regression.md` → `src/agent/modules/sia-regression.md`
- `plans/sia-review.md` → `src/agent/modules/sia-review.md`
- `plans/sia-flagging.md` → `src/agent/modules/sia-flagging.md`
- `plans/sia-tools.md` → `src/agent/modules/sia-tools.md`

---

## Task 10: Write scaffold validation test

- [ ] **Step 1: Write the test**

Create: `tests/unit/scaffold.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../..");

describe("project scaffold", () => {
	it("has package.json with correct name", async () => {
		const pkg = await import(resolve(ROOT, "package.json"));
		expect(pkg.name).toBe("sia");
		expect(pkg.version).toBe("0.1.0");
	});

	it("has tsconfig.json with strict mode", async () => {
		const tsconfig = await import(resolve(ROOT, "tsconfig.json"));
		expect(tsconfig.compilerOptions.strict).toBe(true);
	});

	const requiredDirs = [
		"src/graph",
		"src/workspace",
		"src/capture",
		"src/capture/prompts",
		"src/ast",
		"src/ast/extractors",
		"src/community",
		"src/retrieval",
		"src/mcp",
		"src/mcp/tools",
		"src/security",
		"src/sync",
		"src/decay",
		"src/cli",
		"src/cli/commands",
		"src/shared",
		"src/agent",
		"src/agent/modules",
		"migrations/meta",
		"migrations/bridge",
		"migrations/semantic",
		"migrations/episodic",
		"tests/unit",
		"tests/integration",
	];

	for (const dir of requiredDirs) {
		it(`has directory: ${dir}`, () => {
			expect(existsSync(resolve(ROOT, dir))).toBe(true);
		});
	}

	const requiredAgentModules = [
		"src/agent/claude-md-template.md",
		"src/agent/modules/sia-orientation.md",
		"src/agent/modules/sia-feature.md",
		"src/agent/modules/sia-regression.md",
		"src/agent/modules/sia-review.md",
		"src/agent/modules/sia-flagging.md",
		"src/agent/modules/sia-tools.md",
	];

	for (const file of requiredAgentModules) {
		it(`has agent template: ${file}`, () => {
			expect(existsSync(resolve(ROOT, file))).toBe(true);
		});
	}

	const coreStubs = [
		"src/graph/db-interface.ts",
		"src/graph/entities.ts",
		"src/graph/edges.ts",
		"src/mcp/server.ts",
		"src/capture/pipeline.ts",
		"src/shared/config.ts",
		"src/cli/index.ts",
	];

	for (const file of coreStubs) {
		it(`has stub file: ${file}`, () => {
			expect(existsSync(resolve(ROOT, file))).toBe(true);
		});
	}
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `bun run test:unit`
Expected: FAIL (directories and files don't exist yet — this test will pass after Tasks 6-9 are complete)

---

## Task 11: Run all validations

- [ ] **Step 1: Run unit tests**

Run: `bun run test:unit`
Expected: All scaffold tests PASS

- [ ] **Step 2: Run linter**

Run: `bun run lint`
Expected: exits 0, no errors (warnings acceptable for unused exports)

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: exits 0, no type errors

- [ ] **Step 4: Test CLI via binary entry**

Run: `bun src/cli/index.ts --version`
Expected: `sia v0.1.0`

- [ ] **Step 5: Test CLI via bunx (validates bin entry in package.json)**

Run: `bunx sia --version`
Expected: `sia v0.1.0`

Note: `npx sia --version` also works if npm is available. The `bunx` form exercises the same `package.json` `bin` resolution path.

---

## Task 12: Commit the scaffold

- [ ] **Step 1: Add .gitignore**

Create: `.gitignore`

```
node_modules/
dist/
.DS_Store
*.log
~/.sia/
```

- [ ] **Step 2: Stage and commit**

Run:
```bash
git add -A
git commit -m "feat: project scaffold with full ARCHI §10 directory tree

Initialize Sia with Bun runtime, TypeScript strict mode, Biome linting,
Vitest testing (unit + integration configs), and path aliases. Full directory
tree from ARCHI §10 with stub files. Agent behavioral templates copied from
specs. CLI entry point with --version and --help.

Acceptance criteria met:
- bun run test passes
- bun run lint passes
- sia --version prints version"
```

---

## Execution Order

Tasks must be executed in this order due to dependencies:

1. **Task 1** — Install Bun (prerequisite for everything)
2. **Task 2** — package.json + dependencies (prerequisite for Tasks 3-5)
3. **Task 3** — tsconfig.json (prerequisite for typecheck)
4. **Task 4** — biome.json (prerequisite for lint)
5. **Task 5** — vitest configs (prerequisite for tests)
6. **Task 6 Steps 1-3 only** — Create directories including `tests/unit/` (prerequisite for writing the test file)
7. **Task 10** — Write scaffold test + verify it fails (TDD: test before implementation)
8. **Task 6 Step 4** — Create gitkeep files
9. **Task 7** — Create stub files
10. **Task 8** — CLI entry point
11. **Task 9** — Agent templates
12. **Task 11** — Run all validations (tests should now pass)
13. **Task 12** — Commit
