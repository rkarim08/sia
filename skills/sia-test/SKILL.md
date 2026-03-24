---
name: sia-test
description: Test-driven development enhanced with SIA's knowledge of test conventions, known edge cases, past test failures, and interface contracts from the knowledge graph
---

# SIA-Enhanced Test-Driven Development

Write tests informed by SIA's knowledge graph. This improves upon standard TDD by surfacing how this codebase tests things, what edge cases have caused bugs before, and what the actual interface contracts are.

## What SIA Adds

Standard TDD says "write one minimal failing test." SIA-enhanced TDD first checks:
- **How does this codebase write tests?** — test conventions, patterns, helper utilities
- **What edge cases have failed before?** — past Bug entities in the same area
- **What's the actual interface?** — entity contracts from the graph, not guessed APIs

## Enhanced Red-Green-Refactor

### Before RED — SIA Context Query (NEW)

Before writing the first test:

```
sia_search({ query: "test conventions patterns <area>", node_types: ["Convention"], limit: 10 })
sia_search({ query: "bugs failures edge cases <area>", node_types: ["Bug"], limit: 10 })
sia_by_file({ file_path: "<source_file_being_tested>" })
```

From the results:
- **Test conventions** → follow the same patterns (setup/teardown style, assertion library, naming)
- **Known bugs** → write tests that cover these edge cases
- **File entities** → understand the actual API surface to test against

### RED — Write Failing Test (enhanced)

Write the test following discovered conventions. Include edge cases from known Bug history.

### GREEN — Write Minimal Code (same as standard)

YAGNI — write the simplest code to pass.

### REFACTOR — Clean Up (enhanced)

```
sia_expand({ entity_id: "<entity_under_test>", depth: 1, edge_types: ["calls", "imports"] })
```

Check what depends on the code being refactored. Ensure refactoring doesn't break consumers.

### After Cycle — Capture (NEW)

If a test revealed a new edge case or bug:

```
sia_note({ kind: "Bug", name: "<edge case found>", content: "<description>" })
```

If a new test convention was established:

```
sia_note({ kind: "Convention", name: "<test pattern>", content: "<how we test this type of thing>" })
```

## Key Principle

**Tests should match the codebase's style, not a generic template.** SIA knows how THIS project writes tests — follow that pattern.
