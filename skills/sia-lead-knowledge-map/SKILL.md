---
name: sia-lead-knowledge-map
description: Generates a knowledge distribution map showing module coverage and gaps. Use for identifying bus-factor risks, planning knowledge sharing, or onboarding prioritization.
---

# SIA Knowledge Distribution Map

Visualize how knowledge is distributed across the codebase and team.

## Usage

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts lead-report --type knowledge-map
```

Shows: entities per module, contributors per module, bus-factor risks, coverage gaps.
