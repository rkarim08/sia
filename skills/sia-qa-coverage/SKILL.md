---
name: sia-qa-coverage
description: Analyzes test coverage gaps using SIA's knowledge graph — finds buggy areas without tests and high-churn modules with low coverage. Use when planning test improvements or before releases.
---

# SIA QA Coverage Analysis

Identify areas that need more test coverage based on bug history and code changes.

## How It Works

SIA cross-references:
- **Code entities** (functions, classes) from AST indexing
- **Bug entities** from captured failures
- **Test files** detected in the graph

Areas with bugs but no corresponding test entities = coverage gaps.

## Usage

Ask the sia-qa-analyst agent or run:

```
sia_search({ query: "code entities <module>", node_types: ["CodeEntity"], limit: 50 })
sia_search({ query: "bugs <module>", node_types: ["Bug"], limit: 20 })
```

Cross-reference to find gaps.
