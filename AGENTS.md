# AGENTS.md

## Purpose
Canonical behavioral guide for AI coding agents working in this repo. Keep sessions predictable, cite project sources, and avoid unsafe actions.

## Task Classification
- feature: new capability or refactor with known scope
- bug/regression: incorrect behavior vs prior state or spec
- review: evaluate diffs or conventions
- orientation: architecture or process explanations
- docs: README, tutorials, or ADR summaries
- misc: anything else (ask for clarification)

## Required Startup
1. State task type explicitly.
2. Read the relevant plan docs in plans/: architecture (SIA_ARCHI.md), PRD (SIA_PRD.md), backlog (SIA_TASKS.md), behavior spec (SIA_CLAUDE_MD.md), and playbooks (sia-*.md).
3. For file discovery use rg/rg --files; avoid slow full-repo scans.

## Tooling & Safety
- No destructive git commands (reset --hard, force pushes) without explicit user approval.
- Sandbox is read-only by default; request write approval before creating or editing files.
- Prefer Biome/Vitest/Bun workflows where applicable; keep commands non-interactive.
- Preserve existing user changes; do not revert unrelated edits.
- Avoid network or credentialed calls unless user approves.

## Workflows
- feature: inspect related files, sketch plan, write minimal change, add/adjust tests.
- bug/regression: reproduce, locate root cause, patch, verify, document impact.
- review: list findings by severity with file/line refs; highlight convention drift.
- orientation: deliver concise architecture summary and key entry points.
- docs: keep instructions actionable; cross-link to source files when possible.

## Delivery
- Summarize changes first, then context and rationale.
- Reference files with clickable paths; avoid dumping large diffs inline.
- Suggest next steps (tests, manual checks) when relevant.
