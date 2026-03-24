---
name: sia-dispatch
description: Dispatch parallel agents with SIA's community detection for independence assessment and auto-extracted subgraph context per agent — ensures agents work on truly independent domains
---

# SIA-Enhanced Parallel Agent Dispatch

Dispatch parallel agents with graph-powered independence assessment and rich per-agent context.

## What SIA Adds

Standard dispatch relies on judgment to determine if tasks are independent. SIA-enhanced dispatch:
- **Uses community detection** to formally determine component independence
- **Auto-extracts relevant subgraph** per agent so each gets rich, focused context
- **Checks dependency edges** to verify no shared state between domains

## Enhanced Workflow

### Step 1 — Identify Independent Domains (ENHANCED)

Instead of guessing independence, query the graph:

```
sia_community({ level: 0 })
```

Community clusters represent modules that are tightly connected internally but loosely connected externally. Tasks within the SAME community should be sequential. Tasks in DIFFERENT communities can be parallel.

For each proposed parallel task, verify independence:

```
sia_expand({ entity_id: "<domain_a_entity>", depth: 2, edge_types: ["calls", "imports", "depends_on"] })
sia_expand({ entity_id: "<domain_b_entity>", depth: 2, edge_types: ["calls", "imports", "depends_on"] })
```

If the expansion graphs overlap (shared entities), the tasks are NOT independent. Warn and suggest sequential execution.

### Step 2 — Create Agent Tasks (ENHANCED)

For each agent, auto-extract the relevant subgraph:

```
sia_by_file({ file_path: "<agent's primary file>" })
sia_search({ query: "conventions <agent's domain>", node_types: ["Convention"], limit: 5 })
sia_search({ query: "bugs <agent's domain>", node_types: ["Bug"], limit: 5 })
```

Include the results in each agent's task description:
- Known conventions for this area
- Known bugs to watch for
- Dependency relationships to respect

### Step 3-4 — Dispatch + Integrate (enhanced)

Standard dispatch and review, but after integration:

```
sia_expand({ entity_id: "<modified_entity>", depth: 1 })
```

Verify that no agent's changes broke another's domain by checking edge integrity.

## Key Principle

**Community structure determines parallelizability.** Don't guess — let the graph's clustering tell you what's independent.
