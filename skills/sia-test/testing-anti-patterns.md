# Testing Anti-Patterns Detectable via SIA

Anti-patterns that SIA's knowledge graph can help you detect and prevent.

## Iron Laws

1. **Never test mock behavior** — test real interfaces
2. **Never test implementation** — test behavior
3. **Never ignore known edge cases** — SIA remembers them for you

## Anti-Pattern 1: Ignoring Known Bugs

**Detection:** `sia_search` returns Bug entities for the area, but no tests cover them.

**Gate function:** Before writing tests, query:
```
sia_search({ query: "bugs failures <area>", node_types: ["Bug"], limit: 10 })
```

If results exist, your test suite MUST include regression tests for each.

**Violation:**
```typescript
// Bug entity exists: "Race condition in concurrent user creation"
// Test suite has no concurrency test
test("creates user", () => {
  const user = createUser({ name: "Alice" });
  expect(user.id).toBeDefined();
});
```

**Fix:**
```typescript
test("creates user", () => { /* ... */ });

// Regression test for known Bug entity
test("handles concurrent user creation without race condition", async () => {
  const [a, b] = await Promise.all([
    createUser({ name: "Alice" }),
    createUser({ name: "Bob" }),
  ]);
  expect(a.id).not.toBe(b.id);
});
```

## Anti-Pattern 2: Testing Against Stale Interfaces

**Detection:** `sia_by_file` shows the source file's entities have changed, but tests reference the old API.

**Gate function:** Before writing tests:
```
sia_by_file({ file_path: "<source_file>" })
```

Compare the entity signatures against what your test expects. If the graph shows a newer interface, update your test.

## Anti-Pattern 3: Violating Test Conventions

**Detection:** `sia_search` returns Convention entities for testing patterns, but new tests don't follow them.

**Gate function:**
```
sia_search({ query: "test conventions <area>", node_types: ["Convention"], limit: 5 })
```

If conventions exist (e.g., "use factory functions, not raw constructors"), follow them. Don't invent a new pattern.

## Anti-Pattern 4: Testing Without Dependency Awareness

**Detection:** `sia_expand` shows consumers of the code under test, but tests don't cover the integration points.

**Gate function:** After refactoring:
```
sia_expand({ entity_id: "<refactored_entity>", depth: 1, edge_types: ["calls", "imports"] })
```

If N consumers depend on this code, verify at least the primary integration path is tested.

## Anti-Pattern 5: Duplicating Solved Problems

**Detection:** `sia_search` returns Solution entities that already address the test scenario.

**Gate function:** Before writing a complex test helper:
```
sia_search({ query: "test helper <pattern>", node_types: ["Solution", "Convention"], limit: 5 })
```

If a helper or pattern already exists, use it instead of creating a duplicate.

## Quick Reference

| Anti-Pattern | SIA Query | What to Check |
|---|---|---|
| Ignoring known bugs | `sia_search` for Bug entities | Each bug has a regression test |
| Stale interfaces | `sia_by_file` on source | Test matches current entity signatures |
| Convention violation | `sia_search` for Convention | Tests follow established patterns |
| Missing integration tests | `sia_expand` consumers | Primary integration paths covered |
| Duplicate helpers | `sia_search` for Solution | Existing patterns reused |

## Red Flags

- **Zero Bug entities in a heavily-modified area** → Either the area is perfect (unlikely) or bugs aren't being captured. Run `sia-capture` first.
- **Convention says "use X" but test uses Y** → Follow the convention. If the convention is wrong, update it — don't silently ignore it.
- **sia_expand shows 10+ consumers but only 1 test** → High-risk area with low coverage. Flag to developer.
