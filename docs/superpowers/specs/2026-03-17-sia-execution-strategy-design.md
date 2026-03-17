# Sia Execution Strategy Design

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Full build execution plan for Sia — Persistent Graph Memory for AI Coding Agents

---

## Context

Sia is a persistent, graph-structured memory system for Claude Code and MCP-compatible AI coding agents. The project has comprehensive specifications already written:

- `plans/SIA_PRD.md` — Product requirements (v4.0)
- `plans/SIA_ARCHI.md` — Architecture & technical spec (v4.1)
- `plans/SIA_TASKS.md` — Engineering backlog, 12 phases, 225-290 hours estimated
- `plans/SIA_CLAUDE_MD.md` — Agent behavioral specification (v1.1 modular)
- `plans/sia-*.md` — Contextual playbooks (orientation, feature, regression, review, flagging, tools)

The repo is currently empty (README.md, AGENTS.md only). This document specifies how to execute the build, not what to build — the specs above are authoritative for the latter.

---

## Execution Approach: Hybrid Quality/Speed

### Rationale

The critical path (Phases 1-4) is load-bearing infrastructure where bugs compound into every subsequent phase. Quality-first with TDD here prevents regressions that would cost 10x to fix later. After Phase 4, the remaining phases are largely independent with well-specified acceptance criteria — ideal for speed-optimized parallel execution.

### Three Stages

**Stage 1 — Critical Path (Phases 1-4)**
- Owner: Claude Code (interactive, real-time course correction)
- Approach: Quality-first with TDD, code review at phase boundaries
- Estimated: ~10 sessions, ~80-100 hours (compressed from 98-126h due to pre-written specs and plugin scaffolding)

**Stage 2 — Parallel Expansion (Phases 5-11)**
- Claude Code: Phases 5, 7, 9 (cross-cutting concerns, sequential dependency)
- Codex: Phases 6, 8, 10, 11 (self-contained, run simultaneously)
- Approach: Feature branches off v0.1.0-foundation tag

**Stage 3 — Integration & Polish (Phase 12)**
- Owner: Claude Code
- Approach: After all branches merge. Integration tests, error audit, documentation.

---

## Stage 1: Critical Path Sequencing

### Phase 1 — Storage Foundation (Sessions 1-4)

| Session | Tasks | Key Concern |
|---|---|---|
| 1 (today) | 1.1 Project scaffold via `plugin-dev:create-plugin` | Toolchain validation |
| 2 | 1.13 SiaDb adapter (BLOCKING), 1.2 migration runner | Type-safe DB abstraction |
| 3 | 1.3-1.6 all four DB schemas, 1.11 audit log | Schema correctness |
| 4 | 1.7-1.10 CRUD layers, 1.12 config, 1.14 templates | Bi-temporal logic correctness |

Task 1.13 (SiaDb unified adapter) is the most critical single task — it resolves the bun:sqlite / @libsql/client type mismatch and gates all CRUD work.

Task 1.14 (CLAUDE.md behavioral spec) is accelerated: specs already exist in `plans/SIA_CLAUDE_MD.md` and `plans/sia-*.md`. Copy into `src/agent/`, add template variable substitution. ~2-3h instead of estimated 4-6h.

### Phase 2 — ONNX Embedder (Session 5)

| Session | Tasks | Key Concern |
|---|---|---|
| 5 | 2.1 model download, 2.2 ONNX session + tokenizer, 2.3 cache | 384-dim vector correctness |

### Phase 3 — MCP Server (Sessions 6-7)

| Session | Tasks | Key Concern |
|---|---|---|
| 6 | 3.1 server scaffold, 3.2 sia_search, 3.3 sia_by_file | Read-only connection safety |
| 7 | 3.4-3.8 remaining tools + installer | Bi-temporal query correctness |

### Phase 4 — Capture Pipeline (Sessions 8-10)

| Session | Tasks | Key Concern |
|---|---|---|
| 8 | 4.1 hook + chunker, 4.2 Track A (language registry) | Extractor dispatch architecture |
| 9 | 4.3 Track B (LLM), 4.4 consolidation | INVALIDATE vs ARCHIVE distinction |
| 10 | 4.5-4.9 edge inference, orchestration, cross-repo, compaction, flags | Pipeline timeout + circuit breaker |

**Milestone:** Tag `v0.1.0-foundation` after Phase 4 completion.

---

## Stage 2: Parallel Phase Assignments

### Claude Code (sequential, cross-cutting)

| Phase | Focus | Branch | Dependency |
|---|---|---|---|
| 5 | Workspace & Multi-Repo | `phase-5/workspace` | None (off v0.1.0) |
| 7 | Full Hybrid Retrieval | `phase-7/hybrid-retrieval` | After Phase 5 merges (Task 5.5 before 7.5) |
| 9 | Security Layer | `phase-9/security` | Can overlap Phase 7 tail |

### Codex (parallel, self-contained)

| Phase | Focus | Branch | Dependency |
|---|---|---|---|
| 6 | AST Backbone | `phase-6/ast-backbone` | None (off v0.1.0) |
| 8 | Community Detection & RAPTOR | `phase-8/community` | None (off v0.1.0) |
| 10 | Team Sync | `phase-10/team-sync` | None (off v0.1.0) |
| 11 | Decay, Lifecycle, Flagging | `phase-11/decay-lifecycle` | None (off v0.1.0) |

All 4 Codex branches can run simultaneously — no file conflicts between them.

### Merge Order

1. Phase 6 (Codex) — independent, merge anytime
2. Phase 5 (Claude Code) — must land before Phase 7 starts
3. Phase 7 (Claude Code) — after Phase 5
4. Phases 8, 10, 11 (Codex) — independent, merge anytime
5. Phase 9 (Claude Code) — after Phase 7
6. Phase 12 (Claude Code) — after everything merges

---

## Skills Invocation Map

| Skill | When | Purpose |
|---|---|---|
| `plugin-dev:create-plugin` | Session 1, Task 1.1 | Scaffold plugin structure |
| `superpowers:writing-plans` | After this design is approved | Create executable implementation plan |
| `superpowers:test-driven-development` | Every Phase 1-4 task | Tests first for CRUD, bi-temporal logic, consolidation |
| `feature-dev:feature-dev` | Complex tasks (1.13, 3.2, 4.2) | Deep codebase analysis before implementation |
| `superpowers:executing-plans` | Sessions with 3+ independent tasks | Dispatch parallel subagents |
| `superpowers:dispatching-parallel-agents` | Schema tasks (1.3-1.6), tool tasks (3.4-3.7) | Concurrent independent implementations |
| `superpowers:verification-before-completion` | End of each phase | Verify acceptance criteria |
| `superpowers:requesting-code-review` | End of Phases 1, 4, and before v0.1.0 tag | Catch compounding issues |
| `superpowers:finishing-a-development-branch` | Each Codex branch completion | Structured merge decision |
| `superpowers:using-git-worktrees` | If Claude Code needs isolation during parallel work | Non-blocking branch work |

---

## Today's Deliverable: Project Scaffold (Task 1.1)

### Plugin scaffold via `plugin-dev:create-plugin`
- `plugin.json` manifest with MCP server, hooks, commands
- MCP server entry point stub (6 tool registrations)
- Hook stubs (PostToolUse, Stop)
- CLI command stubs

### Directory structure (ARCHI SS10)
```
src/
  graph/          # db-interface, entities, edges, meta-db, bridge-db, audit, staging, snapshots
  capture/        # hook, chunker, track-a-ast, track-b-llm, consolidate, embedder, pipeline
  ast/            # languages, indexer, watcher, extractors/
  retrieval/      # workspace-search, bm25-search, graph-traversal, reranker, query-classifier
  mcp/            # server, tools/
  sync/           # hlc, push, pull, client, keychain, conflict, dedup
  community/      # leiden, summarize, raptor, scheduler
  decay/          # decay, archiver, consolidation-sweep, episodic-promoter, scheduler
  security/       # pattern-detector, semantic-consistency, rule-of-two, staging-promoter
  workspace/      # detector, manifest, api-contracts, cross-repo
  shared/         # config, types, errors, logger
  cli/            # commands/
  agent/          # claude-md-template.md, claude-md-template-flagging.md, modules/
migrations/       # meta/, bridge/, semantic/, episodic/
tests/            # unit/, integration/
```

### Tooling
- `package.json`: Bun runtime, Biome, Vitest, path aliases
- `tsconfig.json`: strict mode, path aliases (`@/graph`, `@/capture`, etc.)
- `biome.json`: linting config
- `vitest.config.ts`: separate `test:unit` and `test:integration` scripts

### Agent templates (Task 1.14 quick win)
- Copy `plans/SIA_CLAUDE_MD.md` content into `src/agent/claude-md-template.md`
- Copy `plans/sia-*.md` playbooks into `src/agent/modules/`
- Add template variable stubs (`{{SIA_VERSION}}`, `{{WORKSPACE_NAME}}`)

### Validation
- `bun run test` passes on empty suite
- `bun run lint` passes on scaffold
- `npx sia --version` prints version (stub)

---

## Codex Task Specs (for handoff after Phase 4)

Each Codex task should receive:
1. The relevant phase section from `plans/SIA_TASKS.md`
2. The relevant architecture sections from `plans/SIA_ARCHI.md`
3. The branch name to work on
4. The acceptance criteria (already in task doc)
5. Instruction to run `bun run test` and `bun run lint` before marking complete

Codex does NOT need:
- The full PRD (product context is irrelevant to implementation)
- The behavioral spec (only relevant to CLAUDE.md template work)
- The execution strategy (this document — it's for coordination, not implementation)

---

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| SiaDb adapter type mismatch | Task 1.13 is first BLOCKING task in Session 2 — caught early |
| Bi-temporal logic bugs | TDD for all CRUD; separate tests for invalidate vs archive |
| Codex merge conflicts | Phases chosen for Codex have zero file overlap |
| Task 5.5/7.5 coordination | Phase 5 must merge before Phase 7 branch is cut |
| sqlite-vss compatibility | Phase 3 tests verify VSS extension loads with 384-dim insert |
| Scope creep | Specs are locked at v4.0/4.1 — no feature additions during build |
