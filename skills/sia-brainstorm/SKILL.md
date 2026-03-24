---
name: sia-brainstorm
description: Brainstorm features with SIA's knowledge graph context — surfaces past decisions, rejected alternatives, and architectural constraints before proposing approaches. Enhances the brainstorming workflow with cross-session memory.
---

# SIA-Enhanced Brainstorming

Brainstorm ideas into fully formed designs, powered by SIA's knowledge graph. This improves upon standard brainstorming by starting with accumulated project knowledge instead of from scratch.

## What SIA Adds

Standard brainstorming explores the codebase by reading files and recent commits. SIA-enhanced brainstorming also queries:
- **Past decisions** in the same area — what was chosen and why
- **Rejected alternatives** — what was tried and abandoned (bi-temporal `t_valid_until` data)
- **Architectural constraints** — conventions and patterns that must be respected
- **Community structure** — module boundaries and relationships
- **Prior sessions** — what was discussed before about similar topics

## Enhanced Workflow

### Step 0 — SIA Context Retrieval (NEW — before standard exploration)

Before exploring files or asking questions, query the knowledge graph:

```
sia_search({ query: "<feature area description>", task_type: "feature", limit: 15 })
sia_search({ query: "decisions conventions <feature area>", node_types: ["Decision", "Convention"], limit: 10 })
sia_community({ query: "<feature area>", level: 1 })
```

Review the results. Key things to note:
- **Active decisions** that constrain the design space
- **Conventions** that must be followed
- **Past proposals** in this area (check for invalidated entities — `t_valid_until` set — these are rejected approaches)
- **Community structure** showing module boundaries

Present a brief "Graph Context" summary to the user before asking questions:

> **SIA Context:**
> - 3 prior decisions in this area: [list]
> - 2 conventions that apply: [list]
> - 1 previously rejected approach: [description + why rejected]

### Step 1-4 — Collaborative Design

Follow the brainstorming process:
1. Explore project context (enhanced by Step 0's graph data)
2. Ask clarifying questions (one at a time, prefer multiple choice)
3. Propose 2-3 approaches with trade-offs (informed by past decisions)
4. Present design in sections, get approval

**Enhancement in Step 3:** When proposing approaches, explicitly note which prior decisions each approach aligns with or contradicts. If an approach was tried before and rejected, say so and explain what's different now.

### Step 5 — Write Design Doc + Capture Knowledge (ENHANCED)

After writing the design doc:

```
sia_note({ kind: "Decision", name: "<main design decision>", content: "<rationale, alternatives considered, what was rejected>", tags: ["design", "<feature-area>"] })
```

For each rejected alternative:

```
sia_note({ kind: "Decision", name: "Rejected: <alternative>", content: "<why rejected>", supersedes: "<old_decision_id if replacing>" })
```

### Step 6-8 — Review + Handoff

6. **Spec review loop** — dispatch a reviewer subagent to check completeness; fix issues and re-dispatch until approved (max 3 iterations, then surface to human)
7. **User reviews written spec** — ask user to review before proceeding
8. **Transition to implementation** — invoke sia-plan to create an implementation plan

## Key Principles

- **Never brainstorm from zero** — always check what SIA knows first
- **Surface rejected approaches explicitly** — prevent repeating failed ideas
- **Capture the design** — future brainstorming sessions will benefit from this one's output
- **Cite graph entities** — when a prior decision constrains the design, name it
