# Changelog

All notable changes to Sia are documented here. This project adheres to
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- UserPromptSubmit hook now classifies task type and injects top-k memory
  retrieval + open-Concern matches as `additionalContext`. Prompts < 20
  chars skipped. Per-turn memoized; 200 ms hard timeout with graceful
  `db.close()` deferral (via `pendingBackgroundWork`) to prevent leaked
  "database closed" errors from orphaned queries after the timer fires.
  Entity name/summary fields embedded into the block are sanitised
  (leading `#` stripped, triple-backticks downgraded to single) so the
  downstream compactor sees well-formed markdown. Closes Phase 4
  §UserPromptSubmit gap; pushes concern surfacing from pull to push.
- Shared `next_steps` hint helper at `src/mcp/next-steps.ts`; applied to 18 MCP tools (16 weak-trigger + 3 snapshot). Every response now chains to the next natural tool call. Closes Phase 5 §5.7 trigger-weakness gap.
- New skill `sia-verify-before-completion` ports the superpowers
  `verification-before-completion` discipline with Sia's graph-powered
  past-failure lookup.
- PreCompact hook now (a) promotes staged entities via `src/graph/staging.ts::promoteStagedEntities()` and (b) emits a `systemMessage` with the top-5 Preferences + top-3 Episodes so the summariser preserves them verbatim. Closes Phase 4 §PreCompact gap. Staging helper is a safe no-op when the schema lacks staging columns (documented in-source).
- SessionEnd hook performs final staging promotion, aggregates session Signals into EpisodeSummary when ≥ 3 signals fired, and marks `nous_sessions.ended_at`. Closes Phase 4 §SessionEnd gap.

### Changed

- `sia-brainstorm` frontmatter rewritten to superpowers-style mandate:
  "You MUST use this before any creative work…". Body unchanged.
- augment-hook PreToolUse subscriber gains an LRU(32) cache + <3-char query skip (Phase 4 §4.4 cost mitigation). post-tool-use-handler skips TrackA for files >500 KB or binary content. preference-seeder folded into self-monitor as an internal step; SessionStart subscriber count drops 15 → 14 at the design level.
- Consolidated 10 narrow skills into 4 merged skills with subcommand flags: `sia-pm` (sprint-summary/risk-dashboard/decision-log), `sia-export` (json/markdown/import), `sia-qa` (coverage/flaky/full), `sia-health` (stats+status). Skills 48 → 42; commands 40 → 42 (only `stats.md` + `status.md` existed as command shims among the targeted set, per the 1.2.1 pruning rule). Playbooks + docs updated.

### Fixed

- Staging catch blocks surface non-missing-table errors to stderr; null trust_tier defaults to Tier 4 strict threshold.

## [1.3.3] — 2026-04-22

### Added

- Stop hook now (a) runs a lightweight drift recompute when stale to catch mid-session divergence and (b) writes a new `SubagentEpisode` node kind for subagent-session Stops so every session gets an audit trail. Episodes chain remains primary-only. Closes Phase 4 §Stop gap. (fixes: `recomputeDriftIfStale` now honours its never-throws contract via an outer try/catch that logs to stderr and returns a safe no-op; signals-since-last-drift query scoped to `session_id` to prevent cross-session leakage in multi-agent scenarios.)

## [1.3.0] — 2026-04-22

### Added

- `preference-guard` PreToolUse subscriber denies `Bash|Write|Edit` calls that conflict with an active Tier-1 Preference. Conservative pattern-matching (`never X`/`do not X`/`don't X`). Session-cached to keep per-call overhead at ~5–15 ms. This makes captured Preferences enforcing rather than advisory — closes Phase 4 §PreToolUse gap and completes Moat #1 (bi-temporal + trust-tier).

## [1.2.5] — 2026-04-22

Tighten `nous_curiosity` and `/sia-playbooks` contracts; rewrite 9 noun-description skills and 3 agent frontmatters with superpowers-style triggers; add `next_steps` hint to `nous_state` response. Align the `nous_state` curiosity-branch SQL with `nous_curiosity`: both now share the same `access_count <= MAX_ACCESS_COUNT` threshold and the same bookkeeping-kind exclusion set (`NOUS_BOOKKEEPING_KINDS`, which additionally excludes `UserPrompt` and `SessionFlag`).

## [1.2.4] — 2026-04-22

### Changed

- Extract 3 inline snapshot MCP handlers to dedicated
  `src/mcp/tools/sia-snapshot-*.ts` files (no behaviour change; matches
  pattern of other tools). Unblocks Phase A2 next_steps helper rollout.

## [1.2.3] - 2026-04-21

### Removed

Command palette pruned 74 → 40. Every cut command's functionality remains
reachable — skills as `/sia-<name>`, agents as `@sia-<name>`. Only the
short-alias slash shim was removed.

**Skill shim aliases (18):** `/compare`, `/export`, `/export-import`,
`/history`, `/impact`, `/index`, `/playbooks`, `/pm-decision-log`,
`/pm-risk-dashboard`, `/pm-sprint-summary`, `/prune`, `/qa-coverage`,
`/qa-flaky`, `/qa-report`, `/reindex`, `/review-respond`, `/team`,
`/visualize-live`.

**Agent delegation shims (16):** `/changelog-writer`, `/conflict-resolver`,
`/convention-enforcer`, `/decision-reviewer`, `/dependency-tracker`,
`/doc-writer`, `/feature`, `/lead-architecture-advisor`,
`/lead-team-health`, `/migration`, `/pm-briefing`, `/pm-risk-advisor`,
`/qa-analyst`, `/qa-regression-map`, `/search-debugger`, `/test-advisor`.

### Changed

- **Pruning rule (adopted 1.2.3, open for team debate).** Phase 7 deferred
  this cut because no principled rule distinguished a palette-worthy alias
  from clutter. The rule applied here:

  > **KEEP a command if ANY of:**
  >
  > 1. It takes arguments (`argument-hint:` in frontmatter) — the short
  >    alias carries ergonomic value that `/sia-<name>` cannot replicate
  >    without more typing per invocation.
  > 2. It wraps an MCP tool directly (non-shim body that invokes a tool
  >    like `sia_at_time` or `sia_community`) — no corresponding `/sia-X`
  >    skill exists to absorb the command.
  > 3. It is one of the five `/nous-*` cognitive-layer commands —
  >    CLAUDE.md's Nous Tool Contract references these by name as the
  >    canonical slash interface.
  > 4. It is a high-frequency daily-workflow short alias where the short
  >    form provides real discoverability value — the curated set is
  >    `/setup`, `/install`, `/doctor`, `/tour`, `/stats`, `/status`,
  >    `/capture`, `/learn`, `/search`, `/debug`, `/plan`, `/test`,
  >    `/verify`, `/upgrade`, `/finish`, `/brainstorm`, `/execute`,
  >    `/execute-plan`, `/dispatch`, `/conflicts`, `/freshness`,
  >    `/digest`, `/workspace`, `/sync`, plus the agent-canonical
  >    entries `/code-reviewer`, `/pr-writer`, `/refactor`,
  >    `/regression`, `/security-audit`, `/knowledge-capture`,
  >    `/onboarding`, `/orientation`, `/explain`.
  >
  > **CUT a command if ALL of:**
  >
  > 1. It is a 2-line shim with no `$ARGUMENTS` handling.
  > 2. A `/sia-<name>` skill or `@sia-<name>` agent already autocompletes
  >    from the palette.
  > 3. It is not in the daily-workflow curation list above.
  > 4. It is not an MCP-direct or Nous-layer command.

  Rationale: the starting heuristic — "cut any alias whose name is a
  prefix of the canonical `/sia-<name>`" — is too mechanical. It would
  cut `/search` and `/setup` despite those being the highest-frequency
  entries. The refined rule is explicit about which high-frequency
  aliases get protected, so the cut list is defensible rather than
  arbitrary.

- `PLUGIN_USAGE.md` — "Commands (non-shim)" section rewritten as
  "Commands (40)" with three tables (MCP wrappers, Nous layer, short
  aliases) plus an agent-canonical table. Every retained command is
  now listed with its forwarding target.
- `PLUGIN_README.md` — command count updated 74 → 40 with a pointer to
  the pruning rule in this CHANGELOG entry.

## [1.2.2] - 2026-04-21

### Changed
- MCP server configuration moved from `.mcp.json` into the
  `mcpServers` field of `.claude-plugin/plugin.json`, matching the
  newer Claude Code plugin idiom. `.mcp.json` has been deleted.
  Sia's MCP stdio server boots identically — same `command`,
  `args`, and `env` forwarding; this is a packaging change, not a
  behavioural one.

## [1.2.0] - 2026-04-21

### Added
- **Two new agents** bringing the library to 26 agents:
  - `sia-search-debugger` (blue, diagnostic) — when `sia_search`
    returns nothing or off-target, diagnoses whether the graph is
    empty, vocabulary is off, or knowledge was never captured;
    proposes reformulated queries. Matching `/search-debugger` shim.
  - `sia-doc-writer` (green, generator) — generates ADRs, README
    architecture sections, and module docs directly from captured
    Decisions, Conventions, and community summaries. Cites every
    claim; never fabricates rationale. Matching `/doc-writer` shim.
- `commands/README.md`, `agents/README.md`, `skills/README.md`, and
  `hooks/README.md` — contributor-facing authoring guides covering
  file shape, frontmatter, the Phase 4 colour palette, the
  trigger-style description guide, and the hook event matrix. End-user
  guidance continues to live in `PLUGIN_USAGE.md`.
- `argument-hint:` on `commands/learn.md` — the only command whose
  body referenced `$ARGUMENTS` without declaring the hint. Caught
  during the Phase 7.6 frontmatter sweep.

### Changed
- **PLUGIN_README.md slimmed from 267 → 98 lines** as a
  quick-reference card. Prior versions duplicated ~40% of README.md
  prose and drifted independently (the v1.1.5 and v1.1.10 count-fix
  patches are the motivating examples). The new PLUGIN_README links
  to README / CLAUDE / PLUGIN_USAGE / CONTRIBUTING / SECURITY for
  authoritative content and retains only the 29-row MCP tool table,
  install command, and hook event pointer.
- `scripts/count-plugin-components.sh`,
  `scripts/validate-plugin.sh`, and
  `scripts/generate-plugin-usage.sh` now exclude `README.md` from
  agent / command / skill iteration loops so the new component-dir
  READMEs do not inflate counts.

### Skipped / deferred
- **Command-palette pruning (7.3)** — the 73 → ~40 goal risks
  breaking user muscle memory because every skill shim is a shorter
  alias (`/search` ↔ `/sia-search`) with no clear duplicate-vs-alias
  cut line. Deferred to Phase 8 where a principled rule can be
  drafted.
- **Inline `mcpServers` in `plugin.json` (7.5)** — the repo's
  `.mcp.json` at root is auto-discovered by Claude Code and verified
  working; inlining is a newer idiom that was not verified in this
  phase. Leaving `.mcp.json` in place; deferred to a dedicated
  manifest-migration patch.

## [1.1.10] - 2026-04-21

### Added
- `scripts/validate-plugin.sh` — comprehensive plugin-schema validator
  that runs 9 checks (manifest, counts, MCP tool registry, agent
  frontmatter, skill frontmatter, command frontmatter, hook handler
  existence, portability, PLUGIN_USAGE drift). Exits fast on first
  failure with a clear diagnostic; prints an OK summary on success.
- `.github/workflows/plugin-validate.yml` — GitHub Actions workflow
  that runs the validator, tests, type-check, and lint on every PR
  and push to main. This is what should have caught the 17/22/29
  MCP tool-count drift before v1.1.5 had to mop it up.
- `scripts/git-hooks/pre-commit` + CONTRIBUTING.md opt-in instructions
  — contributors who run `git config core.hooksPath scripts/git-hooks`
  get the validator on every commit.

### Fixed
- README.md and PLUGIN_README.md claimed "23 agents" — actual count is
  24 since the `sia-pr-writer` agent landed in v1.1.8. Caught by the
  new validator, which is exactly the drift class it exists to catch.

## [1.1.9] - 2026-04-21

### Added
- SessionStart emits `[Sia] No graph detected for this project. Run
  /sia-setup to bootstrap` when the graph has zero active entities.
  Closes the silent first-run loop — previously a user with a fresh
  install saw no Sia output at all. Gated on the `graph_nodes` table
  existing; no error if a brand-new session predates the schema.
- `ensure-runtime.sh` now logs every invocation to
  `${CLAUDE_PLUGIN_DATA}/logs/ensure-runtime.log` and prints a
  one-line notice to stderr before auto-installing bun.
- Stamp-file-gated invocation of `postinstall.sh` from
  `ensure-runtime.sh`. The `.git` strip and native tree-sitter
  rebuild previously never ran on a fresh install; they now run
  exactly once, logging to
  `${CLAUDE_PLUGIN_DATA}/logs/postinstall.log`.
- `/sia-setup` ends by calling `sia_stats` and suggesting three
  follow-up commands so the user sees the bootstrap worked and has
  an obvious next action.

### Changed
- `scripts/postinstall.sh` no longer swallows build stderr with
  `2>/dev/null`. Failures are now visible in the new postinstall
  log.
- `hooks/hooks.json` — the `PostToolUse` `Write|Edit|Read` matcher
  now carries a `_comment` documenting why `Read` is intentionally
  included (the handler queries the graph for entities associated
  with the read file and returns them as context — see
  `handlers/post-tool-use.ts:379`).

## [1.1.8] - 2026-04-21

### Added
- New `sia-pr-writer` agent (+ `/pr-writer` command) that drafts a PR
  body from the branch diff plus Decisions/Bugs/Solutions captured on
  this branch. Closes the most common missing-agent gap identified in
  the plugin audit.
- `color:` declared on all 24 agents using a semantic palette
  (red=regression/incident, green=feature/create/generate,
  cyan=review/audit, blue=orient/explain,
  purple=plan/architecture/strategy). Previously only 4 agents
  declared a color.

### Changed
- Tool grants expanded on 7 agents whose stated purpose structurally
  required additional MCP tools:
  - `sia-changelog-writer`: +`sia_at_time`, +`sia_backlinks`
    (temporal "since last tag" + dependency-aware release notes)
  - `sia-migration`: +`sia_backlinks`, +`sia_expand`, +`sia_ast_query`,
    +`sia_impact` (cannot find references to renamed entities
    without these)
  - `sia-security-audit`: +`sia_at_time`, +`sia_flag`
    (temporal security events + flagging)
  - `sia-pm-risk-advisor`: +`sia_at_time`, +`sia_by_file`
  - `sia-code-reviewer`: +`sia_at_time`
  - `sia-convention-enforcer`: +`sia_by_file`
  - `sia-conflict-resolver`: +`sia_at_time`, +`sia_flag`

## [1.1.7] - 2026-04-21

### Added
- `PLUGIN_USAGE.md` — consolidated per-skill, per-agent, per-command
  usage guide with invocation triggers and worked examples. Linked
  from README and PLUGIN_README as the canonical entry point for
  "how do I use X?" questions.
- Added or expanded "Usage" documentation on 38 skills that were
  previously thin or missing it. Individual skills keep their
  existing section structure (some use `## Usage`, others split
  into `## When To Use` + `## Worked Example`) — the contract is
  semantic, not syntactic: every skill now covers what it does,
  when to invoke, inputs, and a worked example or typical output.
- Context blurbs on 22 agent-delegation commands so users reading the
  command body understand what the underlying agent does without
  round-tripping to the agent file.
- Positive worked examples on the 5 `/nous-*` commands (previously
  safety-rules only).
- `scripts/generate-plugin-usage.sh` — walks skills/agents/commands
  and regenerates PLUGIN_USAGE.md tables. Supports `--verify` for
  drift detection (used by the Phase 6 validator).

### Changed
- README and PLUGIN_README point to PLUGIN_USAGE.md as the
  per-component entry point.

## [1.1.6] - 2026-04-21

### Removed
- Three `sia-lead-*` skill stubs (`sia-lead-compliance`,
  `sia-lead-drift-report`, `sia-lead-knowledge-map`). Each was a 16-line
  stub that shelled a command without a documented methodology; shipping
  stubs as skills is a broken promise. Leadership reporting remains
  available through the existing `sia-lead-architecture-advisor` and
  `sia-lead-team-health` agents.
- `commands/visualize.md` — dead alias that redirected to
  `/sia-visualize-live`. Kept `sia-visualize-live` as the single entry
  point.

### Changed
- `skills/sia-augment/SKILL.md` description now has an explicit
  "Use when..." trigger so Claude Code routes correctly.
- `skills/sia-playbooks/SKILL.md` description surfaces secondary
  user-visible triggers beyond the CLAUDE.md auto-invoke path.
- `skills/sia-nous/SKILL.md` expanded from 35 lines to a proper
  walkthrough covering the 5 MCP tools, decision tree, 3 worked
  examples, and anti-sycophancy rules.
- Agent `sia-debug` renamed to `sia-debug-specialist` to disambiguate
  from the `sia-debug-workflow` skill. Skill name unchanged.
- Component counts updated: 48 skills → 47 skills (three
  `sia-lead-*` deletions, plus two new `sia-at-time` and
  `sia-community-inspect` skills). Commands: 73 → 71 (three
  `lead-*` + one `visualize` alias removed; `/at-time` and
  `/community` added; `/freshness` already existed).

### Added
- Direct commands for three MCP tools that were previously only
  reachable via agent or raw MCP call: `/freshness`, `/at-time`,
  `/community`. Commands accept the usual argument hints.
- Skills `sia-at-time` and `sia-community-inspect` backing the new
  commands (~40 lines each).

## [1.1.5] - 2026-04-21

### Changed
- Plugin documentation counts corrected to match reality: 29 MCP tools
  (24 sia_* + 5 nous_*), 48 skills, 73 commands, 9 hook entries across 7
  event types. Previously the README mixed "17 tools" and "22 MCP tools"
  on different lines, and "46 skills" was stale by 2.
- Consolidated the keyword arrays in `.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json` to the same authoritative list.
  Dropped the redundant `plugin` tag; added `claude` and `agent-memory`
  for discovery.

### Added
- `## Troubleshooting` section in README covering bun install, MCP
  handshake failures, native tree-sitter build, SQLite/FTS5, doctor
  warnings, empty graphs, and Nous drift warnings.
- `scripts/count-plugin-components.sh` — prints authoritative component
  counts. Used by the plugin validator (lands in Phase 5) to detect
  documentation drift automatically.
- `SECURITY.md` describing the threat model for `sia_execute*`, the
  ensure-runtime bun install behaviour, and the postinstall `.git` strip.
- `CONTRIBUTING.md` with branch-naming convention, the `bun run test` vs
  `bun test` distinction, lint/typecheck commands, and commit-message
  conventions (no Claude attribution, no Co-Authored-By).
- `.claude-plugin/icon.svg` + `icon` field in plugin.json for marketplace
  rendering.

## [1.1.4] - 2026-04-21

### Fixed
- Community-detection bridge no longer attempts to call `detectCommunities`
  on the native module unconditionally. The current `@sia/native` binary
  exposes `astDiff`, `graphCompute`, `isNative`, and `isWasm`, but does
  **not** yet include a Rust Leiden implementation. Before this fix the
  bridge logged "sia: native Leiden failed at runtime: nativeMod.detectCommunities
  is not a function — using JS fallback" on every community-detection call.
  Detection now probes for the function and silently falls through to JS
  Louvain when it is missing.
- `sia doctor` reported "Rust Leiden via graphrs" whenever any tier of the
  native module loaded. It now uses the new `isLeidenAvailable()` probe and
  only claims Leiden when the native module genuinely exports it.

### Added
- README "Running the Test Suite" section clarifying `bun run test`
  (vitest, 2021/2021 pass) vs `bun test` (Bun's native runner, ~400
  bogus failures from `vi.mock` leakage across files).
- `vitest.config.ts` top-of-file banner with the same note so agents or
  contributors touching test configuration see the warning immediately.

## [1.1.3] - 2026-04-21

### Added
- `@sia/native` Rust performance module is now wired as an optional
  dependency. On platforms with a prebuilt binary
  (darwin-arm64, linux-x64-gnu, linux-x64-musl) `sia doctor` reports
  "Native module: Loaded: native" and the community-detection backend
  switches from "JavaScript Louvain" to "Rust Leiden via graphrs".
- Shape adapters in `src/native/bridge.ts` translate between the native
  module's camelCase NAPI surface and the bridge's snake_case public
  contract, covering both `astDiff` and `graphCompute`. Bridge callers
  see an identical result shape regardless of tier (native / wasm /
  typescript). Null parents in AST tree bytes are normalised to empty
  strings before reaching the native module, which declares
  `parent: String` rather than `Option<String>`.
- Integration test suite `tests/unit/native/bridge-native.test.ts`
  exercises the native code path when available and verifies parity
  with the TypeScript fallback for a small AST diff and several graph
  algorithms. The suite skips cleanly on platforms without a binary.

### Changed
- `tests/unit/native/bridge.test.ts` and `tests/unit/cli/doctor.test.ts`
  no longer hard-code "typescript" / "Louvain" expectations — they now
  accept the full tier matrix so CI and developer machines with the
  native binary produce green runs.

## [1.1.2] - 2026-04-21

### Fixed
- Observatory (visualizer) accessibility cleanup — removed the blanket Biome
  a11y override for `src/visualization/frontend/**` and fixed the 44
  resulting violations across `App.tsx`, `GraphCanvas.tsx`, `Sidebar.tsx`,
  `SearchOverlay.tsx`, `ShortcutsModal.tsx`, `CodeInspector.tsx`, and
  `ContextMenu.tsx`:
  - Converted `<div onClick>` patterns to semantic `<button type="button">`
    where possible (search results, file tree entries, entity/edge rows,
    modal backdrops, bookmark items), restoring keyboard accessibility and
    screen-reader labeling.
  - Added explicit `type="button"` to every unlabeled `<button>` to avoid
    the default `"submit"` behavior in a React SPA.
  - Added `role="presentation"` + `aria-hidden="true"` to decorative SVG
    icons sitting next to labeled text.
  - Used stable `item.label` keys in `ContextMenu` instead of array
    indices.
  - Restructured the Node Types sidebar row (previously nested an
    interactive `<input>` and `<label>` inside a `<button>`, which is
    invalid HTML) into a flex row with the color-swatch label and the
    toggle button as siblings.
  - Added `aria-label` / `aria-pressed` / `aria-expanded` on interactive
    controls (close buttons, tab bars, layout mode toggles, folder tree).
- No `// biome-ignore` suppressions were added — all violations fixed
  structurally.

## [1.1.1] - 2026-04-21

### Added
- Defense-in-depth gates for `config.nous.enabled` in the `self-monitor` and
  `episode-writer` inner modules — direct callers (tests, MCP tools) now match
  the plugin hook layer's always-gated behavior.
- README section describing how to disable Nous via `nous.enabled = false`.

### Changed
- Observatory (visualizer) design polish — eight coordinated UI refinements
  bringing the graph view in line with the product's "code observatory"
  vision:
  - Ambient gradient orbs and a radial vignette replace the static dot grid,
    giving the canvas a living, atmospheric feel.
  - Staggered entrance animations (`fadeInDown`, `fadeInUp`, `fadeIn`) on
    the header, sidebar, canvas, and inspector, plus a pulsing SIA wordmark
    while the graph builds.
  - Node glow halos on hover (radial gradient + soft ring) and a
    selected-node pulse ring driven by a `requestAnimationFrame` loop that
    breathes the size factor between 0.85× and 1.15×.
  - Contextual cursor that swaps between `crosshair` (panning) and
    `pointer` (over a node) based on the hover target.
  - Redesigned bottom status bar with node / edge / visible counts,
    active-mode badges (`BLAST`, `FOLDER`, `HULLS`), current layout, and a
    `?` shortcuts hint.
  - Command palette now groups results by node type with uppercase category
    headers and shows a "Quick actions" empty state when the query is blank.
  - Inspector tab bar (`code` / `entities` / `deps`) replacing the single
    stacked scroll, with auto-switch to `entities` for non-file nodes.
  - Node size legend (fn / file / class / decision) in the bottom-left when
    no node is selected.

### Fixed
- Two `toBeUndefined()` assertions against `bun:sqlite` `.get()` results were
  racing against the driver's `null`-for-no-row convention. Normalized both
  tests (plus the new disabled-path tests) to `toBeNull()`.

## [1.1.0] - 2026-04-22

### Added
- Tiered transformer stack (T0–T3): model manager, ONNX session pool,
  SHA-256 verified downloader, cross-encoder reranking (mxbai-rerank-base-v1),
  SIA attention fusion head, dual embeddings (bge-small + jina-code), GLiNER
  on-device NER, feedback collection, and IPS-debiased fusion trainer.
- Auto-reindex: incremental repo reindexing triggered by SessionStart and
  PostToolUse(Bash) hooks; only re-parses files whose content hash changed.
- Nous cognitive layer: four always-active hooks (SessionStart drift,
  PreToolUse significance, PostToolUse discomfort + surprise, Stop episode)
  plus five MCP tools — `nous_state`, `nous_reflect`, `nous_curiosity`,
  `nous_concern`, `nous_modify`.
- MCP surface expanded to 29 tools (added the five Nous tools above).

### Changed
- Search pipeline is now a five-stage path: BM25 + graph + vector retrieval
  → neighbor expansion → cross-encoder filter (T3) → RRF fallback → attention
  fusion (T1+). Lower tiers skip the stages whose models are unavailable.

### Fixed
- 15 pre-existing test failures in AST extractors and subgraph extract.
- 3,821 Biome lint errors caused by a missing `node_modules` exclusion in
  the lint glob.

### Security
- Bumped `@anthropic-ai/sdk` from 0.79 to 0.81 (memory-tool sandbox escape).
- Bumped `vite` from 5.4 to 6.4.2 (path traversal).

[Unreleased]: https://github.com/rkarim08/sia/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/rkarim08/sia/releases/tag/v1.1.0
