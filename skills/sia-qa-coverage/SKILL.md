---
name: sia-qa-coverage
description: Analyzes test coverage gaps using SIA's knowledge graph — finds buggy areas without tests and high-churn modules with low coverage. Use when planning test improvements or before releases.
---

# SIA QA Coverage Analysis

Identify areas that need more test coverage based on bug history and code changes.

## Usage

**When to invoke:**
- Planning test-improvement sprint
- Pre-release coverage audit
- User asks "where are we under-tested?"

**Inputs:** No arguments. Optionally scope via `--module <path>`.

**Worked example:**

```
$ /sia-qa-coverage --module src/orders
[coverage] 14 CodeEntities · 3 Bug entities · 1 dedicated test file
[coverage] GAP: src/orders/refund.ts — 2 Bugs captured, no test entity
[coverage] GAP: src/orders/checkout.ts — 1 Bug, partial test coverage
```

## How It Works

SIA cross-references:
- **Code entities** (functions, classes) from AST indexing
- **Bug entities** from captured failures
- **Test files** detected in the graph

Areas with bugs but no corresponding test entities = coverage gaps.

## Direct MCP queries

Ask the sia-qa-analyst agent or run:

```
sia_search({ query: "code entities <module>", node_types: ["CodeEntity"], limit: 50 })
sia_search({ query: "bugs <module>", node_types: ["Bug"], limit: 20 })
```

Cross-reference to find gaps.
