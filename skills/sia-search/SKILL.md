---
name: sia-search
description: Searches SIA's knowledge graph for project knowledge — decisions, conventions, bugs, patterns, and architecture. Use when looking up past decisions, finding conventions, or querying project history.
---

# SIA Search

Search the project's persistent knowledge graph for relevant information.

## When To Use

Use this skill when you need to:
- Understand project conventions or past decisions
- Find known bugs or solutions
- Look up architecture patterns
- Get context about a specific file or module
- Recall what was discussed in previous sessions

## How To Search

Use the `sia_search` MCP tool directly. It supports these parameters:

- **query** (required): Natural language search query
- **task_type** (optional): One of `orientation`, `feature`, `bug-fix`, `regression`, `review` — helps tune result ranking
- **node_types** (optional): Filter to specific types like `["Decision", "Convention", "Bug"]`
- **package_path** (optional): Scope search to a specific package/module
- **workspace** (optional): Search across all repos in the workspace, not just the current one
- **paranoid** (optional): Enable extra validation on results
- **include_provenance** (optional): Include source provenance metadata in results
- **limit** (optional): Max results (default varies by query type)

### Examples

```
sia_search({ query: "authentication flow", task_type: "feature" })
sia_search({ query: "known bugs in payment module", node_types: ["Bug", "Solution"] })
sia_search({ query: "coding conventions", node_types: ["Convention"], limit: 20 })
```

## Related Tools

- `sia_by_file` — Look up knowledge for a specific file path
- `sia_expand` — Explore the neighborhood of a specific entity
- `sia_community` — Get high-level summaries by community/module
- `sia_at_time` — Query the graph at a historical point in time
- `sia_backlinks` — Find all entities that reference a given entity
- `sia_note` — Record a new Decision, Convention, Bug, Solution, or Concept
