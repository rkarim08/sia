# Contributing to Sia

Thanks for your interest in contributing. This guide covers the conventions this repo relies on. Keep changes focused and follow the patterns already in the codebase.

## Branch naming

Use phase-named branches that describe the body of work. No `feature/`, `fix/`, or `chore/` prefixes.

Examples:
- `plugin-polish-docs`
- `nous-enabled-flag`
- `transformer-stack-activation`

## Running tests

Always run the test suite via the `bun run` wrapper so vitest picks up `vitest.config.ts`:

```bash
bun run test
```

**Do not run `bun test`.** Bun's native test runner bypasses `vitest.config.ts`, skips the path aliases, and surfaces ~400 bogus failures from `vi.mock` leakage across files. The `vitest.config.ts` top-of-file banner (added in v1.1.4) documents this distinction.

The baseline is 2021/2021 passing at v1.1.4.

## Type checking

```bash
bunx tsc --noEmit
```

Must be clean before opening a PR.

## Linting

```bash
bunx @biomejs/biome check .
```

Biome excludes `**/*.md`, so markdown files are not linted, but JSON/TS/JS files are.

## Plugin validator

A plugin validator script lands in Phase 5 and will wire `scripts/count-plugin-components.sh` into the drift check. For now, run that script manually to verify the authoritative component counts:

```bash
bash scripts/count-plugin-components.sh
```

## Commit messages

Conventional-commit subjects (e.g. `fix(native): …`, `feat(mcp): …`, `docs: …`).

**Do not add any of the following:**
- `Co-Authored-By: Claude …` trailers
- `Generated with Claude Code` lines
- Any other AI tool attribution

These are a standing repo convention. If you use an AI tool to draft changes, that's fine — just don't attribute it in commits or PR bodies.

## Pull requests

- One coherent change per PR; squash when merging unless the history has real value.
- PR titles follow the same conventional-commit format as commits.
- Include a short test plan or a note on how you verified the change locally.
- PR bodies must not include Claude / Claude Code / Codex attribution.

## Before opening a PR

Run in order:

```bash
bun run test
bunx tsc --noEmit
bunx @biomejs/biome check .
bash scripts/count-plugin-components.sh
```

All four should succeed cleanly.
