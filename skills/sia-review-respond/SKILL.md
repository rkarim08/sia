---
name: sia-review-respond
description: Responds to code review feedback using SIA's knowledge of past decisions, usage patterns for YAGNI checks, and conflict detection. Use when receiving PR feedback, review comments, or suggestions that may conflict with established conventions.
---

# SIA-Enhanced Code Review Response

Respond to code review feedback grounded in SIA's decision history, usage edges (YAGNI checks), and convention records — argue from the graph, not from memory.

## Checklist

```
- [ ] Step 1: Read all feedback without reacting
- [ ] Step 2: Restate each item in your own words
- [ ] Step 3: Query SIA for decisions/conventions related to each feedback item
- [ ] Step 4: Evaluate — YAGNI via backlinks, conflict check via decision search
- [ ] Step 5: Respond with graph citations
- [ ] Step 6: Implement accepted items one at a time, test each
- [ ] Post: Capture new decisions or convention changes to graph
```

## Workflow

### Step 1 — Read Feedback (same as standard)

Read all feedback without reacting.

### Step 2 — Understand (same as standard)

Restate each item in your own words.

### Step 3 — Verify Against Graph (ENHANCED)

For each feedback item:

```
sia_search({ query: "<feedback topic>", node_types: ["Decision", "Convention"], limit: 10 })
sia_by_file({ file_path: "<file being reviewed>" })
```

Check:
- Does a **past Decision** explain why the current approach was chosen?
- Does a **Convention** mandate the current pattern?
- Was the reviewer's suggestion **tried before and rejected?** (Check invalidated entities)

### Step 4 — Evaluate (ENHANCED)

For YAGNI checks — when a reviewer suggests adding a feature:

```
sia_backlinks({ node_id: "<entity_being_extended>" })
```

Check if any consumer actually needs the suggested extension. If zero backlinks use it → YAGNI.

For conflict checks:

```
sia_search({ query: "decisions <topic>", node_types: ["Decision"], limit: 5 })
```

If the suggestion contradicts an established decision, present the conflict:

> "This suggestion conflicts with [Decision: Use middleware for auth] which was established on [date] because [rationale]. Should we reconsider that decision, or keep the current approach?"

### Step 5 — Respond (enhanced)

When pushing back on feedback, cite SIA entities:

> "The current implementation follows [Convention: Error handlers return structured JSON]. Changing this would break the established pattern documented in entity [id]."

### Step 6 — Implement (same as standard)

One item at a time, test each.

### Post-Implementation — Capture (NEW)

If the review led to new decisions or convention changes:

```
sia_note({ kind: "Decision", name: "<what changed based on review>", content: "<rationale>" })
```

## Key Principle

**Don't argue from memory — argue from the graph.** SIA has the receipts: past decisions, conventions, and their rationale. Use them to validate or push back on feedback with evidence.
