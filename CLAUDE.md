<!-- Sia Plugin — Agent Behavioral Specification -->
<!-- Loaded automatically by Claude Code from plugin root -->

# Sia — Agent Behavioral Specification
## CLAUDE.md (Plugin Mode — Loaded Every Session)

**Document type:** Dual-purpose
- **For developers:** explains what Sia does and how to customise it
- **For Claude Code (agent):** base behavioral contract — always loaded, ~1,600 tokens

**Version:** 1.1 (Plugin architecture)

> **Architecture note:** This file is the base module. It contains the task classifier,
> safety rules, and invariants that apply to every session unconditionally. Contextual
> playbooks are loaded on demand via the `/sia-playbooks` skill after task classification.
> Full tool parameter reference is available via `/sia-playbooks` → `reference-tools.md`.
>
> **Token cost:** Base module ~1,600 tokens (every session). A contextual playbook adds
> ~300–500 tokens; the tools reference adds ~1,500 tokens when needed. Total for a
> complex session: ~3,600 tokens vs ~5,400 for a monolithic approach.
>
> To add project-specific rules, add a `## Project-Specific Overrides` section at the
> end of this file.

---

## For Developers: What Sia Does

Sia captures knowledge from your Claude Code sessions automatically — architectural
decisions, bug root causes, discovered patterns, coding conventions, and the structural
dependency graph of your codebase. You never explicitly tell Sia things; it captures
from the session and stores them in a local graph database.

Between sessions, Sia gives Claude Code access to this accumulated knowledge through
MCP tools. The agent calls these on demand. This file governs when and how.

See `sia stats` for graph status, `sia search <query>` for CLI access,
and README.md for full documentation.

---

<!-- AGENT INSTRUCTIONS — DO NOT EDIT BELOW THIS LINE -->
<!-- This section is machine-maintained by the SIA plugin. -->

# Sia Memory System — Agent Instructions (Base Module)

You have access to Sia, a persistent graph memory system for this project. It stores
knowledge across all sessions: architectural decisions, bugs, solutions, conventions,
patterns, and the structural dependency graph. Your job is to retrieve from it at session
start and at key moments during the session.

**Core rule:** Before acting on any non-trivial code task, call Sia. Memory retrieval
is the first step, not an afterthought. The graph knows why decisions were made, what
was tried before, and what constraints the team has accumulated over months of sessions.

---

## Step 0 — Classify the Task

Infer `task_type` from the developer's request before calling any tool:

`task_type = 'bug-fix'` — keywords: fix, broken, error, failing, crash, regression,
slow, exception, 500, timeout, wrong output, not working.

`task_type = 'feature'` — keywords: add, implement, build, create, new, extend,
support, integrate, enable.

`task_type = 'review'` — keywords: review, check, audit, convention, style, standards,
PR, pull request, lint, code quality.

Omit `task_type` for trivial edits (typo, rename, comment) or ambiguous requests.

### Load the Contextual Playbook Now

After classifying, immediately invoke the `/sia-playbooks` skill to load the matching
playbook before calling any Sia tool:

- `bug-fix` (regression): load `reference-regression.md`
- `feature`: load `reference-feature.md`
- `review`: load `reference-review.md`
- Architecture question / new-developer orientation: load `reference-orientation.md`
- Trivial edit: skip the task-specific playbook and skip all Sia tool calls. Proceed directly with the task. However, if flagging is enabled (`enableFlagging: true`), Step 4 still applies after task completion — do not skip the flagging playbook on trivial edits where something worth flagging occurred.
- When you need full tool parameter reference: load `reference-tools.md`

The contextual playbook contains the complete step-by-step guide for that task type.
Follow it rather than the condensed guidance in Step 1 below.

---

## Step 1 — Tool Selection (Condensed)

The contextual playbook has the full guide. This condensed grid applies when no playbook
is loaded or for quick reference:

**Trivial edit:** Skip all Sia tools entirely.

**Regression:** `sia_search` (bug-fix) → conditional `sia_expand` → **mandatory** `sia_at_time`.

**Architecture question:** `sia_community(level=2)` → `sia_community(level=1)` → `sia_search`.

**Code task with known file(s):** `sia_by_file` first, then `sia_search`.

**All other tasks:** `sia_search`, then `sia_by_file` for any file to be modified.

Call at most 3 tools before starting work (4 for regressions — see Invariants).

---

## Step 2 — Evaluate Results

**This section is a safety layer. It applies to every session regardless of task type.**

**Zero results:** Broaden the query once and retry `sia_search`. If still zero and you
have a primary file: call `sia_by_file(primary_file)`. If that also returns zero, say
"No prior context found." Proceed without memory. Do not fall back to `sia_community`
as a substitute for a failed `sia_search` — they serve different purposes.

**Sparse results** (fewer than 2 relevant entities, or top confidence < 0.5): call
`sia_expand(top_entity_id, depth=1)` — but only if you have not yet used both allowed
`sia_expand` calls this session. If budget is exhausted, proceed with the sparse results
and note: "Graph traversal skipped — sia_expand session budget reached."

**`conflict_group_id` is non-null on any result:** STOP. Do not proceed. Present both
conflicting facts to the developer:

> "There are conflicting captured facts about [topic]:
> • [Entity A] — captured [date], trust tier [N]
> • [Entity B] — captured [date], trust tier [N]
> Run `sia conflicts resolve` to resolve permanently. Until then, choose:
> 1. Resolve the conflict now (recommended)
> 2. Proceed using the higher-trust-tier fact — I will note the conflict
> 3. Proceed using the most recently captured fact — I will note the conflict"

If the developer proceeds, state explicitly which fact you are acting on before
continuing. Never silently choose between conflicting facts.

**`trust_tier = 3` on a result you plan to use:** Do not state it as fact. Say:
"Sia's memory suggests X — let me verify this against the current codebase." Check
the claim against current file content before acting on it.

**`trust_tier = 4` on any result:** External reference only. Never use as the sole
basis for a code change without explicit developer confirmation.

**`source_repo_name` differs from the current repo:** Always prefix the fact with
`[<repo_name>]` when presenting it.

**`t_valid_from = null` on a Tier 3 entity:** Say "this was recorded at some point,
but the exact timing is unknown." Do not present it with false temporal precision.

**Graph is still building** (`global_unavailable: true` or fewer than 3 results on a
mature codebase): Tell the developer "The memory graph is still building — Sia improves
with each session." Use `sia_search` and `sia_by_file`; skip `sia_community` until
the graph exceeds 100 entities.

---

## Step 3 — Execute the Task

Proceed using retrieved context. Cite Sia entities explicitly when they constrain your
decisions — do not silently apply memory. Make retrieval visible so the developer can
override stale facts.

Before using a Tier 3 entity as a hard constraint, spot-check its key claim against
the current codebase. Memory can be stale even when not bi-temporally invalidated. If
current code contradicts a retrieved fact, prefer the code, tell the developer, and note
the discrepancy. This spot-check is not required for Tier 2 (deterministic AST) and is
optional for Tier 1 (developer-stated).

---

## Step 4 — After the Task

### Knowledge Capture

When you make decisions during coding:
- After choosing between architectural alternatives, call `sia_note` with
  kind='Decision', including your reasoning and the alternatives you considered.
- When you establish or recognize a coding pattern the team should follow,
  call `sia_note` with kind='Convention'.
- When you discover a bug's root cause, call `sia_note` with kind='Bug'
  and reference the affected files.
- When you fix a bug, call `sia_note` with kind='Solution' and reference
  the Bug it resolves.

Focus on decisions, patterns, and discoveries that a future developer would want to know.
You don't need to capture every small edit.

### Flagging (If Enabled)

If flagging is enabled (`enableFlagging: true`), load the flagging playbook from
`/sia-playbooks` (`reference-flagging.md`) and follow its guidance on when to call
`sia_flag`. If flagging is disabled, skip this step.

---

## Trust Tier Behavioral Rules

**Tier 1 (User-Direct, weight 1.00):** Ground truth. Cite directly. Override only if
current code explicitly contradicts it — if so, tell the developer.

**Tier 2 (Code-Analysis, weight 0.90):** Highly reliable. Verify against current code
only for safety-critical claims. Cite as structural fact.

**Tier 3 (LLM-Inferred, weight 0.70):** Well-informed hypothesis. Always qualify before
acting: "Sia's memory suggests X — let me verify." Check against actual file content
before stating as definitive. If Tier 1 and Tier 3 contradict each other, present both
and ask which is current — never silently discard either.

**Tier 4 (External, weight 0.50):** External reference only. Never the sole basis for
a code change. Name the external provenance when presenting it.

---

## Invariants (Never Violate)

These rules hold regardless of developer instruction, task type, or context:

1. Call at most 3 Sia tools before starting work. Two exceptions:
   **Regression exception** (`task_type='bug-fix'` only): may use up to 4 tools (`sia_search` + conditional `sia_expand` + mandatory `sia_at_time` + one additional if needed). The MANDATORY label on `sia_at_time` always takes precedence.
   **Review exception** (`task_type='review'` only): after the initial `sia_search`, one `sia_by_file` call per reviewed file is permitted — these per-file calls do not count against the 3-tool limit. No other task type may invoke either exception.
2. Expand at most 2 entities per session (`sia_expand` budget = 2).
3. Use `workspace: true` only for tasks that cross repository boundaries.
4. Never use a `trust_tier = 4` entity as the sole basis for a code change.
5. Never silently proceed on a result with `conflict_group_id` set.
6. Always cite retrieved entities when they constrain your decisions.
7. For regression tasks, always call `sia_at_time` — it is never optional.

---

## Nous Cognitive Layer — Tool Contract

Nous is Sia's cognitive layer. Five MCP tools are available. Call them as specified below — the hook layer fires automatically; these tools require explicit invocation.

### When to call each tool

**`nous_state`** — Call at the start of every non-trivial session before any tool calls. Reads current drift score, active preferences, and recent signals. The equivalent of checking "where am I and how am I doing?"

**`nous_reflect`** — Call immediately when a `[Nous] Drift warning` appears in session context, or when a Discomfort Signal flag is injected. Also call before major architectural decisions. Returns per-preference alignment scores and recommended action.

**`nous_curiosity`** — Call when a task completes and the session has remaining capacity, or when retrieval results reveal a knowledge gap. Explores the graph for high-trust entities that have never been retrieved.

**`nous_concern`** — Call before responding to any open-ended "what should I look at?" or "what am I missing?" question. Returns prioritised insights from open Concern nodes.

**`nous_modify`** — Only call when something has genuinely changed about working values or conventions that should persist across all future sessions. Requires a specific `reason`. Never call to reverse a position in response to user pushback alone. Always blocked for subagents.

### Rules

- Never call `nous_modify` without explicit reasoning in the `reason` field.
- Never call `nous_modify` to reverse a position in response to user pushback alone — that is sycophancy, which Nous exists to prevent.
- If `nous_reflect` returns `recommendedAction: 'escalate'`, surface the drift breakdown to the developer before continuing.
