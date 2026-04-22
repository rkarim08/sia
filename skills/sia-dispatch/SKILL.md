---
name: sia-dispatch
description: Dispatches parallel agents using SIA's community detection for independence verification and auto-extracted subgraph context per agent. Use when facing 2+ independent tasks, parallelizing work, or dispatching subagents.
---

# SIA-Enhanced Parallel Agent Dispatch

Dispatch parallel agents with graph-powered independence verification and rich per-agent context extraction.

## Usage

**When to invoke:**
- 2+ independent tasks you're considering running in parallel
- Large refactor that could be split across subagents
- Any dispatch decision where "are these actually independent?" matters

**Inputs:** No arguments. The skill takes the set of proposed tasks from context.

**Worked example:** Three tasks: (1) add metrics to `api/`, (2) rewrite `docs/README.md`, (3) refactor `api/auth.ts`. Skill runs `sia_community({ level: 0 })` → tasks 1 and 3 are both in the `api` community (must be sequential); task 2 is in `docs` (safe to parallelise with either). Output: dispatch task 2 in parallel with (task 1 → task 3). Per-agent context injected from `sia_search` for conventions + known bugs in each agent's domain.

## Checklist

```
- [ ] Step 1: Query sia_community, verify domains are in different communities
- [ ] Step 2: For each agent — extract conventions, bugs, dependencies from graph
- [ ] Step 3: Dispatch agents with graph context in task descriptions
- [ ] Step 4: After integration — sia_expand to verify no cross-domain breakage
```

## Workflow

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

**For task description format:** See [agent-task-template.md](agent-task-template.md)

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
