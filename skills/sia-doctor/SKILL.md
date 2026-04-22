---
name: sia-doctor
description: Use when Sia tools return errors, after a failed install, or as the first step when something feels wrong with the memory system. Runs full diagnostics on databases, providers, tree-sitter, embeddings, and hook registration before you escalate.
---

# SIA Doctor

Run comprehensive diagnostics on the SIA installation.

## Usage

**When to invoke:**
- `sia_search` or any MCP tool returns an error
- Knowledge feels missing (empty results on mature repos)
- User reports "SIA isn't working" / "hooks aren't firing"
- After upgrade, before filing a bug report

**Inputs:** No arguments required. Optional `checks` via the MCP tool — see below.

**Worked example:**

```
$ /sia-doctor
[sia-doctor] graph_integrity: OK (2,431 entities, 6,104 edges)
[sia-doctor] fts5: OK
[sia-doctor] vss: OK (768-dim vectors)
[sia-doctor] onnx: OK (bge-small-en-v1.5)
[sia-doctor] runtimes: WARN — bun 1.0.30 detected (<1.1 recommended)
[sia-doctor] hooks: OK (9/9 registered)
```

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
