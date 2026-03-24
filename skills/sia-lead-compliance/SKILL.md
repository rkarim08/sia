---
name: sia-lead-compliance
description: Audit convention compliance across the entire codebase — checks every known convention against current code and reports compliance percentage and specific violations
---

# SIA Convention Compliance Audit

Full-codebase audit of convention compliance.

## Usage

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts lead-report --type compliance
```

Shows: each convention with compliance %, specific violations with file paths, overall compliance score.
