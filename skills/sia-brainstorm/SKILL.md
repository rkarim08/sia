---
name: sia-brainstorm
description: Brainstorms features using SIA's knowledge graph — surfaces past decisions, rejected alternatives, and architectural constraints before proposing approaches. Use when starting any creative work, designing features, or modifying behavior.
---

# SIA-Enhanced Brainstorming

Help turn ideas into fully formed designs and specs through natural collaborative dialogue, powered by SIA's knowledge graph. This improves upon standard brainstorming by starting with accumulated project knowledge instead of from scratch.

## Usage

**When to invoke:**
- User starts any creative work — "I want to add X", "how should we design Y?"
- Before touching code on a feature that needs shape
- When revisiting a previously rejected approach and considering a retry

**Inputs:** No arguments. The skill reads the idea from the user's message and drives a multi-round dialogue.

**Worked example:** User: "I want to add a notifications panel." Skill first runs `sia_search({ query: "notifications panel", task_type: "feature" })` → finds a prior rejected design ("polling-based, caused N+1 load"); surfaces it up front ("you tried polling in Jan and rejected it — propose we go with a websocket push?"); proceeds to clarifying questions, then design, then spec doc at `docs/specs/YYYY-MM-DD-notifications-panel-design.md`.

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.
</HARD-GATE>

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every project goes through this process. A todo list, a single-function utility, a config change — all of them. "Simple" projects are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple projects), but you MUST present it and get approval.

## What SIA Adds

Standard brainstorming explores the codebase by reading files and recent commits. SIA-enhanced brainstorming also queries:
- **Past decisions** in the same area — what was chosen and why
- **Rejected alternatives** — what was tried and abandoned (bi-temporal `t_valid_until` data)
- **Architectural constraints** — conventions and patterns that must be respected
- **Community structure** — module boundaries and relationships
- **Prior sessions** — what was discussed before about similar topics

## Checklist

You MUST create a task for each of these items and complete them in order:

1. **SIA Context Retrieval** — query the knowledge graph for prior decisions, conventions, and rejected approaches
2. **Explore project context** — check files, docs, recent commits
3. **Offer visual companion** (if topic will involve visual questions) — this is its own message, not combined with a clarifying question. See the Visual Companion section below.
4. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
5. **Propose 2-3 approaches** — with trade-offs and your recommendation (informed by SIA graph context)
6. **Present design** — in sections scaled to their complexity, get user approval after each section
7. **Write design doc + capture knowledge** — save to `docs/specs/YYYY-MM-DD-<topic>-design.md`, capture decisions to SIA, commit
8. **Spec review loop** — dispatch spec-document-reviewer subagent (see spec-document-reviewer-prompt.md); fix issues and re-dispatch until approved (max 3 iterations, then surface to human)
9. **User reviews written spec** — ask user to review the spec file before proceeding
10. **Transition to implementation** — invoke sia-plan to create implementation plan

## Enhanced Workflow

### Step 0 — SIA Context Retrieval (before any exploration)

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

### Step 1 — Explore Project Context

Check out the current project state (files, docs, recent commits). Before asking detailed questions, assess scope: if the request describes multiple independent subsystems, flag this immediately.

If the project is too large for a single spec, help the user decompose into sub-projects. Each sub-project gets its own spec → plan → implementation cycle.

### Step 2 — Offer Visual Companion

When you anticipate that upcoming questions will involve visual content (mockups, layouts, diagrams), offer the visual companion once for consent:

> "Some of what we're working on might be easier to explain if I can show it to you in a web browser. I can put together mockups, diagrams, comparisons, and other visuals as we go. This feature is still new and can be token-intensive. Want to try it? (Requires opening a local URL)"

**This offer MUST be its own message.** Do not combine it with clarifying questions, context summaries, or any other content. Wait for the user's response before continuing. If they decline, proceed with text-only brainstorming.

**Per-question decision:** Even after the user accepts, decide FOR EACH QUESTION whether to use the browser or the terminal. The test: **would the user understand this better by seeing it than reading it?**

- **Use the browser** for content that IS visual — mockups, wireframes, layout comparisons, architecture diagrams, side-by-side visual designs
- **Use the terminal** for content that is text — requirements questions, conceptual choices, tradeoff lists, A/B/C/D text options, scope decisions

If they agree to the companion, read the detailed guide before proceeding:
`skills/sia-brainstorm/visual-companion.md`

### Step 3 — Ask Clarifying Questions

- One question at a time — don't overwhelm with multiple questions
- Prefer multiple choice when possible, but open-ended is fine too
- Focus on understanding: purpose, constraints, success criteria

### Step 4 — Propose 2-3 Approaches (ENHANCED)

- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**SIA Enhancement:** When proposing approaches, explicitly note which prior decisions each approach aligns with or contradicts. If an approach was tried before and rejected, say so and explain what's different now.

### Step 5 — Present Design

- Scale each section to its complexity: a few sentences if straightforward, up to 200-300 words if nuanced
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing

**Design for isolation and clarity:**
- Break the system into smaller units with one clear purpose each
- For each unit: what does it do, how do you use it, what does it depend on?

### Step 6 — Write Design Doc + Capture Knowledge (ENHANCED)

Write the validated design (spec) to `docs/specs/YYYY-MM-DD-<topic>-design.md` and commit.

**SIA Enhancement — capture decisions to the graph:**

```
sia_note({ kind: "Decision", name: "<main design decision>", content: "<rationale, alternatives considered, what was rejected>", tags: ["design", "<feature-area>"] })
```

For each rejected alternative:

```
sia_note({ kind: "Decision", name: "Rejected: <alternative>", content: "<why rejected>", supersedes: "<old_decision_id if replacing>" })
```

### Step 7 — Spec Review Loop

After writing the spec document:

1. Dispatch spec-document-reviewer subagent (see `skills/sia-brainstorm/spec-document-reviewer-prompt.md`)
2. If Issues Found: fix, re-dispatch, repeat until Approved
3. If loop exceeds 3 iterations, surface to human for guidance

### Step 8 — User Review Gate

After the spec review loop passes, ask the user to review the written spec before proceeding:

> "Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before we start writing out the implementation plan."

Wait for the user's response. If they request changes, make them and re-run the spec review loop. Only proceed once the user approves.

### Step 9 — Transition to Implementation

Invoke sia-plan to create a detailed implementation plan. Do NOT invoke any other skill.

## Key Principles

- **Never brainstorm from zero** — always check what SIA knows first
- **One question at a time** — don't overwhelm with multiple questions
- **Multiple choice preferred** — easier to answer than open-ended when possible
- **YAGNI ruthlessly** — remove unnecessary features from all designs
- **Surface rejected approaches explicitly** — prevent repeating failed ideas
- **Capture the design** — future brainstorming sessions will benefit from this one's output
- **Cite graph entities** — when a prior decision constrains the design, name it
