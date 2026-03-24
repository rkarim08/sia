---
name: sia-test
description: Guides test-driven development using SIA's knowledge of test conventions, known edge cases, and past failures. Use when implementing features or fixes with TDD, writing tests, or establishing test patterns.
---

# SIA-Enhanced Test-Driven Development

TDD informed by SIA's knowledge graph — surfaces this project's test conventions, known edge cases from past bugs, and actual interface contracts before writing the first test.

## Checklist

```
- [ ] Before RED: Query SIA for test conventions, known bugs, file entities
- [ ] RED: Write failing test following discovered conventions + known edge cases
- [ ] GREEN: Minimal code to pass (YAGNI)
- [ ] REFACTOR: Check consumers via sia_expand before refactoring
- [ ] Capture: Note new edge cases or test conventions to graph
```

## Red-Green-Refactor

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

**For common anti-patterns to avoid:** See [testing-anti-patterns.md](testing-anti-patterns.md)

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
