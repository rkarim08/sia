# Changelog

All notable changes to Sia are documented here. This project adheres to
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.1] - 2026-04-21

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

[Unreleased]: https://github.com/rkarim08/sia/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/rkarim08/sia/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/rkarim08/sia/releases/tag/v1.1.0
