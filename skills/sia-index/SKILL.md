---
name: sia-index
description: Use when external markdown, URLs, or design docs need to flow into the graph as citeable evidence — batch-indexes content into `ContentChunk` nodes with automatic chunking so future `sia_search` calls can surface them.
---

# SIA Index

Index external content into the knowledge graph for future retrieval.

## Usage

**Inputs:** One of `content` (markdown/plain text) or `url`; optional `source`, `intent`, `tags`. See MCP tool blocks below.

**Worked example:**

```
sia_index({
  content: "# Rate limiting\nWe chose Redis over Postgres advisory locks for burst-load tolerance.",
  source: "design-doc/rate-limiting-v2",
  tags: ["decision", "api-gateway"]
})
// → ingested 1 chunk, extracted 2 candidate entities (1 Decision, 1 Concept)
```

## When To Use

Use this skill when you need to:
- Index documentation, meeting notes, or design docs
- Fetch and index content from a URL
- Add external knowledge to the project graph

## MCP Tools

### sia_index — Index text content

```
sia_index({
  content: "## Architecture Decision\n\nWe chose PostgreSQL over MongoDB because...",
  source: "architecture-review-2026-03",
  tags: ["decision", "database", "architecture"]
})
```

Parameters:
- **content** (required): Markdown or plain text to index
- **source** (optional): Source identifier for provenance tracking
- **tags** (optional): Tags for categorization

### sia_fetch_and_index — Fetch a URL and index its content

```
sia_fetch_and_index({
  url: "https://docs.example.com/api-reference",
  intent: "Index API documentation for reference",
  tags: ["api", "documentation"]
})
```

Parameters:
- **url** (required): URL to fetch (must be a valid URL)
- **intent** (optional): Why this content is being indexed
- **tags** (optional): Tags for categorization

## Notes

- Content is chunked using content-type-aware strategies (heading-based for markdown, line-based for plain text)
- Entities and relationships are automatically extracted from chunks
- SSRF protection is built in — private IPs and DNS rebinding are blocked
- Requires the ONNX embedding model for vector indexing (run `sia-doctor` to check)
