---
name: sia-playbooks
description: Load SIA task-specific playbooks for regression analysis, feature development, code review, or project orientation — called automatically by CLAUDE.md behavioral directives
---

# SIA Task Playbooks

This skill provides detailed step-by-step guidance for using SIA's knowledge graph during specific task types. The CLAUDE.md behavioral spec directs you here after task classification.

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
