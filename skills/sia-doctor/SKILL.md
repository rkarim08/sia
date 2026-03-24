---
name: sia-doctor
description: Run SIA system health diagnostics — check databases, providers, tree-sitter, embeddings, and connectivity
---

# SIA Doctor

Run comprehensive diagnostics on the SIA installation.

## Steps

Run the doctor command:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/doctor.ts
```

This checks:
- Database integrity (graph.db, episodic.db, meta.db, bridge.db)
- Tree-sitter parser availability and grammar loading
- ONNX embedding model availability
- LLM provider connectivity (if configured)
- Hook registration status
- Disk usage

## MCP Tool

You can also run diagnostics via the `sia_doctor` MCP tool with targeted checks:

```
sia_doctor({ checks: ["all"] })
sia_doctor({ checks: ["graph_integrity", "onnx"] })
```

Valid check names: `runtimes`, `hooks`, `fts5`, `vss`, `onnx`, `graph_integrity`, `all`

## Interpreting Results

Each check reports: OK, Warning, or Error with remediation steps.
