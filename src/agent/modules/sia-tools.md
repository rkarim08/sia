# Sia — Full Tool Parameter Reference

*Read this module when you need complete parameter documentation for any Sia tool,*
*or when the base module's condensed guidance is insufficient for the task at hand.*

---

## `sia_search` — General Memory Retrieval

Your primary tool. Call at the start of every non-trivial task.

```
sia_search({
  query: string,
  // Conversational language works well: "session timeout expiry behavior"
  // rather than keyword fragments: "timeout session".

  task_type?: 'bug-fix' | 'feature' | 'review',
  // Boosts entity types relevant to the task:
  //   bug-fix  → Bug, Solution, Decision entities ranked higher
  //   feature  → Concept, Decision entities ranked higher
  //   review   → Convention entities ranked higher

  node_types?: string[],
  // Further narrow by type: ['Decision','Convention'], ['Bug','Solution'], etc.
  // Use when you know the category of what you're looking for.

  package_path?: string,
  // Monorepo: scope to a specific package path. Reduces cross-package noise
  // when working in a single package of a large monorepo.

  workspace?: boolean,
  // Default false. Set true ONLY for cross-repo tasks: API contracts between
  // linked repositories, shared types, cross-service calls.
  // Never use for single-repo tasks — adds 400ms latency and cross-repo noise.

  paranoid?: boolean,
  // Default false. Set true when auditing external dependencies or when you want
  // to query the graph without surface-level exposure to Tier 4 content.
  // Filters Tier 4 entities from retrieval results only — does NOT prevent Tier 4
  // content from being captured into the graph, and does NOT guarantee memory
  // integrity.
  //
  // If the developer expresses concern about memory poisoning or graph integrity,
  // paranoid: true on queries is insufficient. Direct them to:
  //   paranoidCapture: true in ~/.sia/config.json
  // which quarantines Tier 4 at the chunker stage (the hard guarantee). For past
  // captures, suggest: npx sia rollback to inspect and revert if needed.

  limit?: number,
  // Default 5. Use 10 for architectural queries. Use 15 ONLY for PR review
  // (full convention coverage required). Never use 15 as a default.

  include_provenance?: boolean,
  // Default false. When true, adds extraction_method to entity results.
  // WHEN TO USE — set true only when:
  //   (a) two Tier 3 results contradict each other (spacy is more reliable
  //       than llm-haiku — provenance lets you choose the more reliable one)
  //   (b) the developer asks how a fact was captured
  //   (c) you are about to use a Tier 3 entity as a hard constraint on a
  //       security-critical or data-migration task
  // DO NOT use by default — adds payload for no benefit on routine queries.
  //
  // Values when true:
  //   'tree-sitter' = deterministic AST extraction (Tier 2, fully reliable)
  //   'spacy'       = deterministic NLP (Tier 3, highly reliable)
  //   'llm-haiku'   = probabilistic LLM extraction (Tier 3, can hallucinate)
  //   'user-direct' = developer stated this explicitly (Tier 1)
  //   'manifest'    = declared in .sia-manifest.yaml (Tier 1)
  // Conflict rule: prefer 'spacy' over 'llm-haiku' for Tier 3 disambiguation.
})
```

---

## `sia_by_file` — File-Scoped Memory Retrieval

Call before modifying any file you have not worked on recently. Returns everything
Sia knows about that file: decisions made about it, bugs found in it, patterns it
implements, conventions that apply to it. This is a complement to `sia_search`,
not an alternative — use both.

```
sia_by_file({
  file_path: string,   // relative path from project root
  workspace?: boolean, // default false — include cross-repo edges for this file
  limit?: number,      // default 10
})
```

---

## `sia_expand` — Graph Relationship Traversal

Call when a search result is relevant but you need to understand how it connects to
the rest of the graph. Use sparingly — the session budget is 2 calls.

```
sia_expand({
  entity_id: string,             // the ID from a sia_search or sia_by_file result
  depth?: 1 | 2 | 3,            // default 1; see depth guide below
  edge_types?: string[],         // see edge type guide below
  include_cross_repo?: boolean,  // default false
})
```

**Depth guide:**
`depth=1` — immediate neighbors only. Use for 90% of cases.
`depth=2` — multi-step causal chains. Use for regression tracing and dependency audits.
`depth=3` — full dependency impact. The 50-entity neighbor cap will usually bind here;
use only when a complete impact analysis is explicitly needed.

**Edge type guide:**
Regression investigation: `edge_types=['supersedes', 'caused_by', 'solves']`
Dependency analysis:      `edge_types=['calls', 'imports', 'depends_on']`
Decision history:         `edge_types=['supersedes', 'elaborates', 'contradicts']`
Bug-to-solution:          `edge_types=['solves', 'caused_by']`

**Hard constraints:**
Never expand all results from a `sia_search` — context overflow is guaranteed.
Never call `sia_expand` on Community entities — they already contain synthesised summaries.
Budget: 2 calls per session maximum.

**Edge truncation:** `SiaExpandResult.edge_count` is the total active edges in the
neighborhood. `edges[]` is capped at 200. If `edge_count > edges.length`, the traversal
is incomplete. Narrow with an `edge_types` filter or reduce `depth` and re-call.

---

## `sia_community` — Architectural Summaries

Use for broad structural questions, architectural orientation, and module-level
understanding. Not for specific entity lookups — use `sia_search` for those.

```
sia_community({
  query?: string,          // topic description for community selection
  entity_id?: string,      // OR: get the community containing this specific entity
  level?: 0 | 1 | 2,      // default 1; see level guide below
  package_path?: string,   // monorepo: scope to a specific package
})
```

**Level guide:**
`level=2` — Coarse architectural overview. Use for: new developer orientation,
system-wide design questions, "how does this system work?" queries.
`level=1` — Subsystem / module level. Use for: "how does the auth module work?",
before implementing a feature that spans a module.
`level=0` — Fine-grained cluster view. Rarely needed by the agent; more useful
from the CLI. Avoid in agent workflows.

Never use `sia_search("architecture")` as a substitute for `sia_community` — it
returns raw entity snippets (a list of class names) rather than synthesised summaries.

---

## `sia_at_time` — Temporal Graph Query

Use for historical investigation: regressions, architecture evolution, "what changed
about X?", "what was true before this broke?"

```
sia_at_time({
  as_of: string,            // ISO 8601 OR relative: "7 days ago", "3 months ago", "January"
  entity_types?: string[],  // narrow by entity type
  tags?: string[],          // narrow by tag
  limit?: number,           // default 20, max 50. Applies to BOTH entities[] and
                            // invalidated_entities[]. Increase for large regressions
                            // (many entities changed at once).
})
```

**Output:** A `SiaTemporalResult` with two entity arrays and an edge array:
- `invalidated_entities[]` — facts that ENDED on or before `as_of`. The change history.
  Sorted by `t_valid_until DESC` (most recently ended first — highest priority for
  regression diagnosis). Each entry's `t_valid_until` is exactly when that fact ended.
- `entities[]` — facts still valid at `as_of`. Compare against current `sia_search`
  output to see what has changed since.
- `edges[]` — edges valid at `as_of`, capped at 50.
- `edge_count` — total edges valid at `as_of` before the 50-cap truncation. If
  `edge_count > edges.length`, the edge set is incomplete — narrow with `entity_types`
  or `tags` to retrieve remaining edge context.

When `invalidated_count > invalidated_entities.length`, entity results are truncated.
Make additional narrowed calls with `entity_types` or `tags` filters to retrieve
remaining entries. Do not assume you have the complete picture until
`invalidated_count == invalidated_entities.length`.

`sia_at_time` has no meaning in isolation. Always compare its output against the current
graph (a current `sia_search` call) to identify what changed and what superseded each
invalidated fact.

**When `t_valid_from` is null in a result:** the entity was recorded but Sia could not
determine when it became true in the world. Say "this was the state at some point before
[as_of], but the exact start date is unknown."

---

## `sia_flag` — Mid-Session Capture Signal (If Enabled)

Available only when `npx sia enable-flagging` has been run. See
`src/agent/modules/sia-flagging.md` for full guidance.

```
sia_flag({ reason: string })   // max 100 characters after sanitization
```

The `reason` is sanitized before storage. Characters stripped: `<`, `>`, `{`, `}`,
`[`, `]`, `\`, quotes, and control characters. Permitted: colons, backticks,
underscores, forward slashes, `@`, and all standard punctuation. Natural root-cause
descriptions pass through correctly.

If the tool returns a disabled error, tell the developer: "This moment seems worth
capturing. Run `npx sia enable-flagging` if you want in-session capture — otherwise
Sia will attempt to capture it at session end via the Stop hook, with lower precision."

---

## Three Paranoid Modes — They Are Not Equivalent

These are three distinct mechanisms that are frequently confused:

**`paranoid: true` on `sia_search`** (or `npx sia search --paranoid` from CLI): filters
Tier 4 facts from query results only. It does not prevent external content from being
captured into the graph. A developer who uses this flag expecting "no external content
will enter my graph" is mistaken — they have only filtered what they see, not what
is stored.

**`paranoidCapture: true` in `~/.sia/config.json`**: quarantines all Tier 4 content at
the capture pipeline's chunker stage. This is the hard guarantee. External content never
reaches staging, never reaches the main graph, and appears only as a `QUARANTINE` entry
in the audit log.

**`--paranoid` CLI flag**: equivalent to `paranoid: true` on `sia_search` — retrieval
filtering only, not capture-side isolation.

If a developer asks for the strongest isolation from external content, direct them to
`paranoidCapture: true` in config, not the query-time flag. Both can be used together
for defence in depth.
