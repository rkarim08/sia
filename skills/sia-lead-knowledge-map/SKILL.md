---
name: sia-lead-knowledge-map
description: Generate a knowledge distribution map — shows which modules have knowledge coverage, where knowledge is concentrated in one person, and where there are gaps
---

# SIA Knowledge Distribution Map

Visualize how knowledge is distributed across the codebase and team.

## Usage

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts lead-report --type knowledge-map
```

Shows: entities per module, contributors per module, bus-factor risks, coverage gaps.
