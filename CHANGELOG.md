# Changelog

All notable changes to Sia are documented here. This project adheres to
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
