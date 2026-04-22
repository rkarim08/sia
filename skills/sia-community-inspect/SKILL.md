---
name: sia-community-inspect
description: Inspect the Leiden-detected community structure of the knowledge graph at a given hierarchy level. Use for architecture orientation, module-boundary questions, or understanding how Sia has clustered the codebase.
---

# SIA Community Inspect — Partition Structure

Return the hierarchical community partitioning of the graph at a requested resolution level. Sia runs Leiden community detection across the dependency + semantic edges and produces a two-level hierarchy.

## When to call

- **Architecture orientation.** First call when a new developer asks "how is this codebase organised?" Load the level-2 (coarse) view first, then drill down to level-1 (fine) where interesting.
- **Module-boundary questions.** "Which module does this entity belong to?" / "What else lives in the same cluster as X?"
- **Refactor impact pre-check.** Before reshaping module boundaries, read the current partitioning to see what Sia thinks the boundaries already are.

## What the levels mean

- `level=2` — **Coarse.** Small number of large clusters (usually 5–12). Good for a one-slide architecture picture.
- `level=1` — **Fine.** Many smaller clusters inside each level-2 cluster. Good for spotting single-responsibility violations or unexpected coupling.

## Parameters

- `level` — `1` (fine) or `2` (coarse). Default `2`.
- `min_size` (optional) — hide clusters with fewer than N entities.

## Typical output

Prose summary listing each community: cluster ID, size, top entities by PageRank, and a one-line summary of what the cluster appears to be about.

## Worked example

New contributor asks "what are the main areas of this codebase?"

```
sia_community({ level: 2 })
```

Sia returns (for example):

- **C1 (82 entities)** — Storage layer: graph DB, embedding pipeline, HLC clock
- **C2 (61 entities)** — MCP server + tool surface
- **C3 (44 entities)** — Hooks: augment, Nous drift, significance scoring
- **C4 (38 entities)** — CLI and scripts

Then drill: `sia_community({ level: 1 })` inside C1 to see storage sub-clusters.

## Related

- CLAUDE.md: architecture-question tool selection starts with `sia_community(level=2)` → `sia_community(level=1)` → `sia_search`.
- Playbook: `reference-orientation.md` (load via `/sia-playbooks`).
