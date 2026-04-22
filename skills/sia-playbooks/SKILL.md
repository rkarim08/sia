---
name: sia-playbooks
description: Load task-specific Sia playbooks (reference-regression, reference-feature, reference-review, reference-orientation, reference-tools). Called automatically by CLAUDE.md behavioral directives, and also useful when looking up full MCP tool parameter reference or task-type semantics.
---

# SIA Task Playbooks

This skill provides detailed step-by-step guidance for using SIA's knowledge graph during specific task types. The CLAUDE.md behavioral spec directs you here after task classification.

## Usage

**When to invoke:**
- CLAUDE.md Step 0 classifier points to a task type (bug-fix / feature / review / orientation)
- You need the full MCP tool parameter reference (`reference-tools.md`)
- Looking up flagging guidance (`reference-flagging.md`)

**Inputs:** Reference filename passed inline in the skill invocation (e.g. `reference-regression.md`). No CLI arguments.

**How it works:** Skill body below lists the available reference files and the load-on-demand pattern. The playbook file itself contains the step-by-step workflow for that task type.

## Available Playbooks

Load the playbook matching your task type by reading the corresponding reference file in this skill's directory:

| Task Type | Reference File |
|---|---|
| Bug fix / Regression | `reference-regression.md` |
| Feature development | `reference-feature.md` |
| Code review | `reference-review.md` |
| Orientation / Architecture | `reference-orientation.md` |
| Full tool reference | `reference-tools.md` |
| Flagging guidance | `reference-flagging.md` |

## Workflow

1. CLAUDE.md classifies the task (bug-fix, feature, review, orientation)
2. CLAUDE.md directs you to invoke `/sia-playbooks`
3. Read the matching reference file from this skill's directory
4. Follow the step-by-step guidance in the playbook
5. The playbook tells you exactly which SIA tools to call and in what order
