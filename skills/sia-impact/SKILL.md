---
name: sia-impact
description: Analyzes the impact of a planned code change — maps dependencies, callers, importers, and downstream effects using the knowledge graph. Use before refactoring, renaming, or modifying shared code.
---

# SIA Impact Analysis

Before making a structural change (rename, move, split, delete, signature change), analyze what will be affected.

## How To Use

Provide the entity or file you plan to change:

- `/sia-impact src/auth/login.ts` — impact of changing this file
- `/sia-impact processPayment` — impact of changing this function
- `/sia-impact UserProfile type` — impact of changing this type

## Analysis Steps

The impact analysis chains these SIA tools:

### 1. Find the entity
```
sia_search({ query: "$ARGUMENTS", node_types: ["CodeEntity", "CodeSymbol"] })
sia_by_file({ file_path: "$ARGUMENTS" })
```

### 2. Map incoming dependencies
```
sia_backlinks({ node_id: "<entity_id>" })
```
This shows everything that imports, calls, or depends on the target.

### 3. Trace the ripple effect
```
sia_expand({ entity_id: "<dependent_id>", depth: 2, edge_types: ["calls", "imports", "depends_on"] })
```
For each direct dependent, check what depends on THEM.

### 4. AST-level verification
```
sia_ast_query({ file_path: "<affected_file>", query_type: "imports" })
sia_ast_query({ file_path: "<affected_file>", query_type: "calls" })
```
Get precise import and call sites in affected files.

### 5. Check conventions
```
sia_search({ query: "conventions <area>", node_types: ["Convention"] })
```
Are there conventions about how changes should be made in this area?

## Output Format

Present the impact as a structured report:

| File | Dependency | Impact Type | Action Needed |
|---|---|---|---|
| path/file.ts | imports X | Direct | Update import |
| path/other.ts | calls X | Direct | Update call site |
| path/test.ts | tests X | Direct | Update test |
| path/downstream.ts | uses Y which uses X | Indirect | Verify behavior |

## When To Use

- Before renaming a function, class, or type
- Before moving files between directories
- Before changing a function's signature
- Before splitting or merging modules
- Before removing exports or APIs

## Worked Example

```
$ /sia-impact processPayment
[impact] entity: src/orders/charge.ts::processPayment (CodeEntity)
[impact] incoming: 7 callers, 3 importers
  · src/orders/checkout.ts:42 — calls
  · src/api/webhooks.ts:18 — calls
  · src/orders/refund.ts:91 — calls
  · test/orders/charge.spec.ts — tests
  ...
[impact] conventions: 1 ("All charge paths must be idempotent")
[impact] known bugs in this area: 2 — review before changing signature
```
