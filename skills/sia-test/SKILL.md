---
name: sia-test
description: Guides test-driven development using SIA's knowledge of test conventions, known edge cases, and past failures. Use when implementing features or fixes with TDD, writing tests, or establishing test patterns.
---

## Invariants

> These rules have NO exceptions. Violating any one means starting over.
>
> 1. YOU MUST query SIA before writing the first test. A test written without
>    querying SIA may miss known edge cases and WILL be deleted and rewritten.
> 2. Every Bug entity returned by SIA for the area MUST have a corresponding
>    regression test. No exceptions.
> 3. Tests MUST follow the conventions discovered in the graph. "I prefer a
>    different style" is not a valid reason to deviate.

## Red Flags — If You Think Any of These, STOP

| Thought | Why It's Wrong |
|---------|---------------|
| "This is too simple for a SIA query" | Simple-looking areas are where regressions hide. The query takes 2 seconds; missing a known bug costs hours. |
| "I already know the test conventions" | The graph may contain conventions from sessions you weren't part of. Check. |
| "I'll query SIA after writing the tests" | By then you've already locked in assumptions. Query FIRST. |
| "There probably aren't any known bugs here" | You don't know what you don't know. That's why the graph exists. |
| "The test file already has patterns I can follow" | File patterns may be outdated. SIA knows the current conventions. |

# SIA-Enhanced Test-Driven Development

TDD informed by SIA's knowledge graph — surfaces this project's test conventions, known edge cases from past bugs, and actual interface contracts before writing the first test.

## Checklist

```
- [ ] Before RED: YOU MUST query SIA for test conventions, known bugs, and file entities. Without this, you will miss edge cases. No exceptions.
- [ ] RED: Write failing test following discovered conventions + known edge cases. Every Bug entity MUST have a regression test.
- [ ] GREEN: Minimal code to pass (YAGNI — do NOT over-implement)
- [ ] REFACTOR: YOU MUST query sia_expand before refactoring to verify no consumers break
- [ ] Capture: Note new edge cases or test conventions to graph. A test session that discovers patterns but doesn't capture them is incomplete.
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
