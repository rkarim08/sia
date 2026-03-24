---
name: sia-plan
description: Writes implementation plans using SIA's knowledge of module topology, architectural constraints, and project conventions. Use when creating multi-step implementation plans or breaking down specs into tasks.
---

# SIA-Enhanced Plan Writing

Write implementation plans pre-loaded with architectural constraints, module boundaries, and conventions from SIA's knowledge graph.

## Checklist

```
- [ ] Step 0: Load graph context — community structure, decisions, conventions
- [ ] Step 1: Scope check — use community boundaries to find natural split points
- [ ] Step 2: File structure — sia_by_file for each file to understand dependencies
- [ ] Step 3: Task definition — embed graph context (conventions, dependencies, known bugs) per task
- [ ] Step 4-6: Standard plan writing, review, handoff
```

## Workflow

### Step 0 — Load Graph Context (NEW)

Before file structure mapping, query the graph:

```
sia_community({ level: 1 })
sia_search({ query: "<feature area> architecture patterns", node_types: ["Decision", "Convention"], limit: 15 })
sia_search({ query: "file structure module organization <area>", node_types: ["Convention"], limit: 10 })
```

Use community structure to understand module boundaries. Use conventions to know how this codebase organizes code.

### Step 1 — Scope Check (enhanced)

When checking if the spec should be decomposed, use community boundaries from the graph to determine natural split points — not just intuition.

### Step 2 — File Structure (ENHANCED)

When mapping which files to create/modify:

```
sia_by_file({ file_path: "<each_file_to_modify>" })
```

For each file, understand:
- What entities already exist in this file
- What depends on this file (via edges)
- What conventions apply to this area

This prevents plans that unknowingly violate module boundaries or break downstream consumers.

### Step 3 — Task Definition (ENHANCED)

For each task, include relevant graph context in the task description:
- "This file follows the [Convention Name] pattern — see entity [id]"
- "Function X is called by Y and Z — changes must be backward-compatible"
- "This area had a bug [Bug Name] — test for regression"

### Step 4-6 — Standard plan writing, review, handoff

**After writing the plan:** Dispatch plan reviewer subagent — see [plan-reviewer-prompt.md](plan-reviewer-prompt.md)

Follow the standard plan document format, review loop, and execution handoff.

## Key Principle

**Plans that respect existing architecture succeed faster.** SIA's graph knows the module topology, conventions, and dependencies. Use this to write plans that work WITH the codebase, not against it.
