---
name: sia-export-knowledge
description: Exports the knowledge graph as a human-readable markdown document covering decisions, conventions, bugs, and architecture. Use for team onboarding, documentation generation, or sharing knowledge outside SIA.
---

# SIA Knowledge Export

Generate a comprehensive markdown document summarizing everything SIA knows about your project.

## Usage

**Default** (writes to `KNOWLEDGE.md`):
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts export-knowledge
```

**Custom output path:**
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts export-knowledge --output docs/project-knowledge.md
```

**Custom project name:**
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts export-knowledge --name "My Project"
```

## What It Generates

A structured markdown document with:

1. **Architectural Decisions** — what was chosen, why, and what was rejected
2. **Coding Conventions** — patterns and rules to follow
3. **Known Issues** — active bugs with descriptions
4. **Solutions** — how past bugs were fixed
5. **Key Concepts** — domain terminology and system behavior
6. **Architecture** — community structure showing module clusters

Each entry includes: date captured, trust tier (verified/code-derived/inferred/external), and affected files.

## When To Use

- **Team onboarding** — share with new developers before their first session
- **Knowledge audit** — review what SIA has captured, identify gaps
- **External sharing** — generate a knowledge summary for stakeholders
- **Backup** — human-readable export of the knowledge graph
- **Documentation** — commit as living documentation alongside code

## Worked Example

```
$ /sia-export-knowledge --output docs/project-knowledge.md --name "Acme Platform"
[export-knowledge] Wrote docs/project-knowledge.md
  · 24 Decisions · 18 Conventions · 12 Bugs · 10 Solutions · 6 Concepts
  · Architecture section covers 6 communities
```
