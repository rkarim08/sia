---
name: sia-tour
description: Provides an interactive guided tour of the knowledge graph — architecture, decisions, conventions, and known issues. Use for onboarding, exploring what SIA knows, or getting oriented in a new project.
---

# SIA Graph Tour

Take a guided tour of what SIA knows about your project.

## Usage

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts tour
```

## What It Shows

1. **Architecture Overview** — major module clusters from community detection
2. **Key Decisions** — architectural choices and their rationale
3. **Coding Conventions** — patterns to follow
4. **Known Issues** — active bugs to be aware of
5. **Ingested Documentation** — docs in the knowledge graph

## When To Use

- After `/sia-setup` or `/sia-learn` — see what was discovered
- When onboarding to a project — get the full picture
- After a long break — refresh your memory of the project
- When a new team member joins — share what SIA knows

## Worked Example

```
$ /sia-tour
[tour] Architecture: 6 communities
  · api-gateway (142 entities) — HTTP routing, middleware
  · orders (88) — checkout, charge, refund
  · docs-site (61) — marketing + API reference
  · auth (54) — session, session-store
  · analytics (39) — event pipeline
  · infra (27) — deploy scripts
[tour] Key decisions (top 5): ...
[tour] Active bugs: 2
[tour] Run /sia-search <topic> to drill in.
```
