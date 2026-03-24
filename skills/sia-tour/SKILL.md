---
name: sia-tour
description: Interactive guided tour of the knowledge graph — walks through architecture, decisions, conventions, known issues, and documentation
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
