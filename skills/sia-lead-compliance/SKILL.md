---
name: sia-lead-compliance
description: Audits convention compliance across the codebase — checks every known convention against current code and reports violations. Use for code quality audits, tech lead reviews, or enforcing team standards.
---

# SIA Convention Compliance Audit

Full-codebase audit of convention compliance.

## Usage

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts lead-report --type compliance
```

Shows: each convention with compliance %, specific violations with file paths, overall compliance score.
