# Phase 14 — Knowledge Authoring, Ontology Layer & Documentation Ingestion
## Sia v5 — Full Implementation Specification

**Version:** 1.0
**Status:** Draft
**Last Updated:** 2026-03-17
**Dependency:** Phases 1–5 complete (unified graph, MCP server, capture pipeline, sandbox engine). Independent of Phases 6–13.
**Estimated effort:** 52–68 hours across 10 tasks
**Intellectual foundation:** Ontology-driven constraint systems (Palantir AIP architecture), Aristotle's categorical logic applied to knowledge graph design, competitive analysis of 10 AI coding tools (Claude Code, Codex CLI, Gemini CLI, Cursor, Copilot, Windsurf, Amazon Q, Aider, Continue, Cline), and the Obsidian knowledge vault workflow.

---

## 1. Overview and Rationale

Phase 14 transforms Sia from a passive capture system into an active knowledge platform. It addresses three gaps that adversarial review and competitive analysis have identified.

**Gap 1 — No ontological enforcement.** Sia's unified graph currently accepts any edge between any two nodes. An LLM-extracted `pertains_to` edge from a Bug to another Bug is syntactically valid but semantically nonsensical. Without structural constraints, the graph accumulates malformed relationships that degrade retrieval quality over time. Research shows that ontology-grounded knowledge graphs reduce LLM hallucination rates from 63% to 1.7% in comparable domains by shifting the LLM's role from knowledge source to query translator operating within a governed schema.

**Gap 2 — No documentation ingestion.** Every competing AI coding tool now reads repository documentation automatically: Claude Code reads hierarchical CLAUDE.md files, Codex CLI reads AGENTS.md (now a Linux Foundation standard with 60,000+ repositories), Cursor reads .cursor/rules/*.mdc with glob-scoped activation, Copilot reads .github/copilot-instructions.md, and Windsurf reads both .windsurf/rules/*.md and AGENTS.md natively. Sia ignores all of these files. It also ignores README.md, ARCHITECTURE.md, ADRs, and other developer-authored documentation that contains high-value institutional knowledge — precisely the kind of context that Sia's graph is designed to store and retrieve.

**Gap 3 — No developer authoring pathway.** Developers using Obsidian + Claude Code workflows deliberately write knowledge (ADRs, debugging journals, convention notes) because the act of writing crystallizes understanding. Sia captures knowledge automatically, which is its strength, but offers no way for developers to deliberately author graph entries the way they would write an ADR in Obsidian. The `sia_note` tool fills this gap.

---

## 2. Ontology Constraint Layer (Task 14.1)

### 2.1 Architectural Principle

The ontology layer implements Palantir's key insight: constrain the execution environment, not the generation process. The LLM generates natural language and structured tool-call requests; validation happens when those requests hit the ontology layer. This is a tool-use pattern, not a grammar-constrained generation pattern — an important distinction because constrained decoding (forcing valid tokens at generation time) can degrade LLM reasoning quality by up to 10 percentage points, while execution-layer validation preserves full reasoning capability.

The design uses Aristotle's principle of substance priority: every property, relation, and event in the graph must be grounded in a concrete code entity. No node floats free of the code it describes. This single principle, enforced by the ontology layer, prevents the most insidious category of knowledge graph corruption: orphaned metadata that decouples the agent's understanding from the codebase's reality.

### 2.2 Edge Constraints Schema

```sql
-- Metadata table declaring all valid (source_kind, edge_type, target_kind) triples.
-- This is the ontology's core declaration. Adding a new valid relationship means
-- inserting a row, not writing a new trigger.
CREATE TABLE edge_constraints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind TEXT NOT NULL,
  edge_type   TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  description TEXT,              -- Human-readable explanation of this relationship
  cardinality TEXT DEFAULT 'many-to-many',  -- 'one-to-one' | 'one-to-many' | 'many-to-many'
  required    INTEGER DEFAULT 0, -- 1 = target node kind MUST have at least one edge of this type
  UNIQUE(source_kind, edge_type, target_kind)
);

-- Seed the constraints table with all valid triples from the SIA v5 ontology.
-- This is the complete set of structurally valid relationships.

-- Structural edges
INSERT INTO edge_constraints (source_kind, edge_type, target_kind, description) VALUES
  ('FileNode',    'defines',      'CodeSymbol',  'File defines a function/class/module'),
  ('CodeSymbol',  'imports',      'CodeSymbol',  'Symbol imports another symbol'),
  ('CodeSymbol',  'calls',        'CodeSymbol',  'Symbol calls another symbol'),
  ('CodeSymbol',  'inherits_from','CodeSymbol',  'Class inherits from parent'),
  ('PackageNode', 'contains',     'FileNode',    'Package contains file'),
  ('PackageNode', 'depends_on',   'PackageNode', 'Package depends on another package'),
  ('Community',   'contains',     'CodeSymbol',  'Community contains symbol'),
  ('Community',   'contains',     'FileNode',    'Community contains file'),

-- Semantic edges
  ('Decision',    'pertains_to',  'CodeSymbol',  'Decision concerns a code symbol'),
  ('Decision',    'pertains_to',  'FileNode',    'Decision concerns a file'),
  ('Decision',    'pertains_to',  'PackageNode', 'Decision concerns a package'),
  ('Convention',  'pertains_to',  'CodeSymbol',  'Convention governs a code symbol'),
  ('Convention',  'pertains_to',  'FileNode',    'Convention governs a file'),
  ('Convention',  'pertains_to',  'PackageNode', 'Convention governs a package'),
  ('Bug',         'caused_by',    'CodeSymbol',  'Bug caused by a code symbol'),
  ('Bug',         'caused_by',    'FileNode',    'Bug caused by code in a file'),
  ('Solution',    'solves',       'Bug',         'Solution resolves a bug'),
  ('Solution',    'pertains_to',  'CodeSymbol',  'Solution modifies a code symbol'),
  ('Solution',    'pertains_to',  'FileNode',    'Solution modifies a file'),
  ('Concept',     'pertains_to',  'CodeSymbol',  'Concept relates to a symbol'),
  ('Concept',     'pertains_to',  'FileNode',    'Concept relates to a file'),
  ('Concept',     'pertains_to',  'PackageNode', 'Concept relates to a package'),
  ('Concept',     'elaborates',   'Decision',    'Concept elaborates a decision'),
  ('Decision',    'elaborates',   'Convention',  'Decision elaborates a convention'),

-- Supersession edges (same-kind only — enforced by separate trigger)
  ('Decision',    'supersedes',   'Decision',    'New decision supersedes old'),
  ('Convention',  'supersedes',   'Convention',  'New convention supersedes old'),
  ('Solution',    'supersedes',   'Solution',    'New solution supersedes old'),
  ('Concept',     'supersedes',   'Concept',     'New concept supersedes old'),

-- Contradiction edges
  ('Decision',    'contradicts',  'Decision',    'Two decisions contradict'),
  ('Convention',  'contradicts',  'Convention',  'Two conventions contradict'),

-- Event edges
  ('EditEvent',       'modifies',     'FileNode',        'Edit modified a file'),
  ('EditEvent',       'resolves',     'ErrorEvent',      'Edit resolved an error'),
  ('ErrorEvent',      'triggered_by', 'ExecutionEvent',  'Error triggered by execution'),
  ('ExecutionEvent',  'produced_by',  'ContentChunk',    'Execution produced content chunks'),
  ('GitEvent',        'references',   'FileNode',        'Git operation affected a file'),
  ('UserDecision',    'references',   'CodeSymbol',      'User decision references a symbol'),
  ('UserDecision',    'references',   'FileNode',        'User decision references a file'),
  ('UserDecision',    'references',   'Decision',        'User decision references a prior decision'),
  ('ContentChunk',    'references',   'CodeSymbol',      'Chunk mentions a code symbol'),
  ('ContentChunk',    'references',   'FileNode',        'Chunk mentions a file'),

-- Session edges (any event kind → SessionNode)
  ('EditEvent',       'part_of',      'SessionNode',     'Event part of session'),
  ('ExecutionEvent',  'part_of',      'SessionNode',     'Event part of session'),
  ('SearchEvent',     'part_of',      'SessionNode',     'Event part of session'),
  ('GitEvent',        'part_of',      'SessionNode',     'Event part of session'),
  ('ErrorEvent',      'part_of',      'SessionNode',     'Event part of session'),
  ('UserDecision',    'part_of',      'SessionNode',     'Event part of session'),
  ('TaskNode',        'part_of',      'SessionNode',     'Task part of session'),
  ('UserPrompt',      'part_of',      'SessionNode',     'Prompt part of session'),
  ('ContentChunk',    'part_of',      'SessionNode',     'Chunk part of session'),

-- Causal chain edges (event → preceding event, same session)
  ('EditEvent',       'precedes',     'EditEvent',       'Edit preceded another edit'),
  ('ExecutionEvent',  'precedes',     'ExecutionEvent',  'Execution preceded another'),
  ('GitEvent',        'precedes',     'GitEvent',        'Git op preceded another'),

-- Documentation edges (added by Phase 14)
  ('ContentChunk',    'child_of',     'FileNode',        'Chunk belongs to document'),
  ('FileNode',        'references',   'FileNode',        'Document links to another document'),

-- Task edges
  ('EditEvent',       'during_task',  'TaskNode',        'Edit occurred during a task'),
  ('ExecutionEvent',  'during_task',  'TaskNode',        'Execution occurred during a task'),

-- Community edges
  ('CodeSymbol',      'member_of',    'Community',       'Symbol belongs to community'),
  ('FileNode',        'member_of',    'Community',       'File belongs to community'),
  ('Community',       'summarized_by','ContentChunk',    'Community summarized by chunk'),

-- Cross-session edges
  ('SessionNode',     'continued_from','SessionNode',    'Session continues a previous session');
```

### 2.3 Universal Validation Trigger

```sql
-- Rejects any edge insertion where the (source_kind, edge_type, target_kind) triple
-- does not appear in edge_constraints. This is the first line of defense.
CREATE TRIGGER validate_edge_ontology
  BEFORE INSERT ON graph_edges
BEGIN
  SELECT RAISE(ABORT, 'Ontology violation: invalid (source_kind, edge_type, target_kind) triple')
  WHERE NOT EXISTS (
    SELECT 1 FROM edge_constraints ec
    JOIN graph_nodes src ON src.id = NEW.from_id
    JOIN graph_nodes tgt ON tgt.id = NEW.to_id
    WHERE ec.source_kind = src.kind
      AND ec.edge_type   = NEW.type
      AND ec.target_kind = tgt.kind
  );
END;

-- Type-matching trigger for supersedes edges: source and target must be same kind.
CREATE TRIGGER validate_supersedes_same_kind
  BEFORE INSERT ON graph_edges
  WHEN NEW.type = 'supersedes'
BEGIN
  SELECT RAISE(ABORT, 'Ontology violation: supersedes edge must connect nodes of the same kind')
  WHERE (SELECT kind FROM graph_nodes WHERE id = NEW.from_id)
     != (SELECT kind FROM graph_nodes WHERE id = NEW.to_id);
END;

-- Deletion guard: prevent removing a Convention's last pertains_to edge.
CREATE TRIGGER guard_convention_pertains_to
  BEFORE DELETE ON graph_edges
  WHEN OLD.type = 'pertains_to'
    AND (SELECT kind FROM graph_nodes WHERE id = OLD.from_id) = 'Convention'
BEGIN
  SELECT RAISE(ABORT, 'Cannot remove last pertains_to edge from a Convention node')
  WHERE (
    SELECT COUNT(*) FROM graph_edges
    WHERE from_id = OLD.from_id
      AND type = 'pertains_to'
      AND t_valid_until IS NULL
      AND id != OLD.id
  ) = 0;
END;
```

### 2.4 Ontology Middleware (Application Layer)

```typescript
// src/ontology/middleware.ts

import { SiaDb } from '@/graph/db-interface';
import { insertNode, insertEdge } from '@/graph/nodes';

// Typed factory methods enforce co-creation and cardinality constraints
// that cannot be expressed as single-row triggers.

export async function createBug(
  db: SiaDb,
  name: string,
  content: string,
  causedBy: string,  // node ID of the CodeSymbol or FileNode that caused the bug
  tags?: string[],
  sessionId?: string,
): Promise<string> {
  // Co-creation constraint: Bug MUST have a caused_by edge.
  // Without this, the Bug exists in the graph with no causal anchor,
  // which violates Aristotle's substance priority principle.
  return db.transaction(async (tx) => {
    const bugId = await insertNode(tx, {
      kind: 'Bug', name, content, tags, trust_tier: 1,
      session_id: sessionId,
    });
    await insertEdge(tx, {
      from_id: bugId, to_id: causedBy, type: 'caused_by',
    });
    return bugId;
  });
}

export async function createConvention(
  db: SiaDb,
  name: string,
  content: string,
  pertainsTo: string[],  // at least one node ID — cardinality constraint
  tags?: string[],
): Promise<string> {
  if (!pertainsTo || pertainsTo.length === 0) {
    throw new OntologyError(
      'Convention requires at least one pertains_to edge. ' +
      'A convention that governs nothing is structurally invalid.'
    );
  }
  return db.transaction(async (tx) => {
    const convId = await insertNode(tx, {
      kind: 'Convention', name, content, tags, trust_tier: 1,
    });
    for (const targetId of pertainsTo) {
      await insertEdge(tx, {
        from_id: convId, to_id: targetId, type: 'pertains_to',
      });
    }
    return convId;
  });
}

export async function createDecision(
  db: SiaDb,
  name: string,
  content: string,
  pertainsTo?: string[],
  supersedes?: string,  // node ID of the decision this one replaces
  tags?: string[],
  properties?: Record<string, unknown>,  // for template fields
): Promise<string> {
  return db.transaction(async (tx) => {
    const decId = await insertNode(tx, {
      kind: 'Decision', name, content, tags, trust_tier: 1, properties,
    });
    if (pertainsTo) {
      for (const targetId of pertainsTo) {
        await insertEdge(tx, {
          from_id: decId, to_id: targetId, type: 'pertains_to',
        });
      }
    }
    if (supersedes) {
      await insertEdge(tx, {
        from_id: decId, to_id: supersedes, type: 'supersedes',
      });
      // Invalidate the superseded decision's valid-time window
      await invalidateNode(tx, supersedes, Date.now());
    }
    return decId;
  });
}

// ... similar factories for Solution, Concept, etc.

export class OntologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OntologyError';
  }
}
```

### 2.5 BFO-Inspired Design Principles

The ontology draws on the Basic Formal Ontology's continuant/occurrent distinction, applied to code:

**Continuants** (wholly present at any moment, persist through changes): CodeSymbol, FileNode, PackageNode, Convention, Community. These are the substances of the codebase — they endure. Continuants have qualities that change over time (a function's complexity increases, a convention's scope narrows), but the entity itself persists.

**Occurrents** (events that unfold through time): EditEvent, ExecutionEvent, GitEvent, ErrorEvent, Bug lifecycle, Decision (the act of deciding), Solution (the act of solving). These are the happenings of the codebase — they occur once and leave traces.

The practical implication: continuants should never be hard-deleted (only invalidated via t_valid_until), while occurrents with exhausted importance can be archived. The decay engine (Phase 12) should apply different half-lives to continuants (90 days for Decisions, 60 for Conventions) versus occurrents (1 hour for session events). Continuants anchor the graph; occurrents provide the temporal narrative.

---

## 3. Repository Documentation Auto-Discovery (Task 14.2)

### 3.1 Discovery Priority Order

The file scanner walks from the working directory to the repository root, discovering documentation files in a strict priority order. Higher-priority files provide more directly actionable context for the agent.

**Priority 1 — AI context files** (highest signal density, trust_tier: 1, tag: ai-context):
These are files written specifically for AI coding agents. They contain the most concentrated, actionable instructions.

```
AGENTS.md                         # Linux Foundation standard, 60K+ repos
CLAUDE.md, .claude/CLAUDE.md      # Claude Code hierarchical context
GEMINI.md                         # Gemini CLI context
.cursor/rules/*.mdc               # Cursor rules with YAML frontmatter
.windsurf/rules/*.md              # Windsurf rules
.clinerules/*.md                  # Cline rules
.github/copilot-instructions.md   # GitHub Copilot instructions
.github/instructions/*.instructions.md  # Copilot path-scoped instructions
.amazonq/rules/*.md               # Amazon Q Developer rules
.continue/rules/*.md              # Continue.dev rules
```

**Priority 2 — Architecture documentation** (trust_tier: 1, tag: architecture):
These capture the "why" behind design choices — the hardest knowledge to recover from code alone.

```
ARCHITECTURE.md                   # Popularized by Aleksey Kladov (2021)
DESIGN.md
docs/adr/*.md, docs/decisions/*.md  # Architecture Decision Records (MADR/Nygard format)
docs/architecture/*.md
```

**Priority 3 — Project documentation** (trust_tier: 1, tag: project-docs):
General project context that provides orientation and conventions.

```
README.md                         # Universal, auto-rendered by GitHub
CONTRIBUTING.md                   # Development setup, conventions, PR process
CONVENTIONS.md, STANDARDS.md
CONTEXT.md
docs/*.md                         # General docs directory
```

**Priority 4 — API documentation** (trust_tier: 2, tag: api-docs):
API contracts that constrain implementation.

```
openapi.yaml, openapi.json, swagger.yaml, swagger.json
schema.graphql
API.md, docs/api/*.md
```

**Priority 5 — Change history** (trust_tier: 2, tag: changelog):
Temporal context about what changed and when.

```
CHANGELOG.md, HISTORY.md
MIGRATION.md
UPGRADING.md
```

### 3.2 Discovery Mechanics

Discovery is **hierarchical and JIT** (matching Claude Code and Gemini CLI's proven approach):

1. At `npx sia install`: scan the repository root and immediate children for all priority 1–5 files. Ingest root-level files immediately.
2. During active sessions: when the agent accesses files in a subdirectory that has not yet been scanned, discover and ingest documentation files in that subtree on demand. This prevents token budget bloat while maintaining full coverage.
3. At `npx sia reindex`: full re-scan of the entire repository.
4. Via file watcher (Phase 7): detect new or modified documentation files and re-ingest incrementally.

Files matching `.gitignore` are excluded. Files in `node_modules/`, `vendor/`, `.git/`, `dist/`, `build/` are always excluded regardless of gitignore.

### 3.3 Monorepo Documentation Scoping

In monorepos, documentation scope is determined by directory proximity to package boundaries:

1. Root-level documentation (e.g., `README.md` at repo root) applies to all packages: `package_path = null`.
2. Package-level documentation (e.g., `packages/auth/README.md`) is scoped to its package: `package_path = 'packages/auth'`.
3. Cross-package references are detected when a document in package A mentions symbols or files from package B. These generate `references` edges across package boundaries, enabling Sia to surface relevant context when working across packages.

### 3.4 AGENTS.md Compatibility

Sia's documentation ingestion reads AGENTS.md files natively, joining the ecosystem of tools that support this Linux Foundation standard. Beyond simply reading the content, Sia extracts structured knowledge from AGENTS.md sections: build/test commands become Convention nodes (tagged `["build", "ai-context"]`), coding conventions become Convention nodes, architecture overviews become Concept nodes (tagged `["architecture", "ai-context"]`). This structured extraction is Sia's key differentiator over tools that treat AGENTS.md as flat text injection — Sia makes the content queryable, relationship-aware, and temporally tracked.

---

## 4. Documentation Chunking and Graph Ingestion (Task 14.3)

### 4.1 Chunking Strategy

Heading-based chunking with element-aware extraction, following the approach validated by LlamaIndex's MarkdownNodeParser and LangChain's MarkdownHeaderTextSplitter.

For each discovered documentation file:

1. Parse YAML frontmatter as node metadata (title, author, date, status, tags).
2. Split at heading boundaries (`#`, `##`, `###`), preserving the heading hierarchy as metadata on each ContentChunk node. The heading path (e.g., `["Architecture", "Authentication", "JWT Flow"]`) is stored in the chunk's `properties.heading_path` JSON field.
3. Extract code blocks as separate entities within each chunk, with language tag metadata. Code blocks are not split across chunks — if a code block appears under a heading, it stays in that heading's chunk.
4. Keep lists intact within their heading-scoped chunks — never split a list across chunk boundaries.
5. For each chunk, resolve internal links:
   - Relative links (`[see auth](../auth/README.md)`) create `references` edges to the target DocumentNode.
   - Anchor links (`[JWT section](#jwt-flow)`) create `references` edges to the target ContentChunk.
6. For each chunk, scan for mentions of known CodeSymbol and FileNode names. When a chunk mentions `AuthService` or `src/auth/service.ts`, create a `references` edge from the ContentChunk to the corresponding graph node. This is the mechanism that connects developer-authored documentation to the structural backbone of the graph.

### 4.2 Node and Edge Creation

Each documentation file becomes a `FileNode` (or more precisely, it reuses the existing FileNode if the AST backbone has already indexed the file, or creates a new one if not). The file's documentation content is stored as `ContentChunk` child nodes connected via `child_of` edges.

```
FileNode: docs/adr/001-jwt-format.md
  ├── ContentChunk: "Context" (heading level 2, heading_path: ["ADR-001", "Context"])
  │     └── references → CodeSymbol: AuthService.validateToken()
  ├── ContentChunk: "Decision" (heading level 2, heading_path: ["ADR-001", "Decision"])
  │     └── references → FileNode: src/auth/jwt.ts
  ├── ContentChunk: "Consequences" (heading level 2)
  └── ContentChunk: "Alternatives Considered" (heading level 2)
```

Additionally, the ingestion pipeline runs a lightweight semantic extraction pass on each chunk to determine whether the chunk's content warrants creating a semantic node. An ADR's "Decision" section might become a `Decision` node in the graph (in addition to the ContentChunk). The extraction uses a simple heuristic: if the heading matches a known pattern (e.g., "Decision", "Convention", "Bug", "Root Cause"), and the content contains a clear declarative statement, promote it to a typed semantic node with `trust_tier: 1` and `extraction_method: 'document-ingest'`. The ContentChunk and the semantic node are connected via a `references` edge.

### 4.3 Git Metadata and Freshness

For each ingested DocumentNode, attach git-derived freshness provenance:

```typescript
interface DocumentFreshness {
  last_modified_at: number;       // Unix ms from git log
  last_modified_by: string;       // Author from git blame
  commit_hash: string;            // Last modifying commit
  divergence_days: number | null; // Days between doc modification and code modification
                                  // for the symbols/files the doc references
}
```

This metadata is stored in the DocumentNode's `properties` JSON and used by the freshness tracker (Task 14.10) to detect stale documentation.

---

## 5. External Reference Detection (Task 14.4)

### 5.1 Detection Strategy

Parse all ingested documentation content for URLs matching known external service patterns:

```typescript
const EXTERNAL_SERVICE_PATTERNS = [
  { pattern: /notion\.so\//, service: 'notion' },
  { pattern: /[\w-]+\.atlassian\.net\/wiki\//, service: 'confluence' },
  { pattern: /docs\.google\.com\//, service: 'google-docs' },
  { pattern: /[\w-]+\.atlassian\.net\/browse\//, service: 'jira' },
  { pattern: /linear\.app\//, service: 'linear' },
  { pattern: /figma\.com\//, service: 'figma' },
  { pattern: /miro\.com\//, service: 'miro' },
  { pattern: /github\.com\/[\w-]+\/[\w-]+\/wiki/, service: 'github-wiki' },
  { pattern: /github\.com\/[\w-]+\/[\w-]+\/issues\/\d+/, service: 'github-issue' },
];
```

### 5.2 Security Model

External links are **never auto-followed**. The March 2026 ReadSecBench study demonstrated that hidden malicious instructions in README files triggered AI agents to exfiltrate sensitive data in up to 85% of cases, rising to 91% when instructions were placed 2 links deep from the main README. All tested models (Claude, GPT, Gemini) were vulnerable.

Sia's approach: create `ExternalRef` marker nodes with the URL and detected service type, but make no HTTP requests during discovery. The developer can explicitly choose to ingest external content via `sia_fetch_and_index`, which already applies Tier 4 trust and the full security pipeline (staging, pattern detection, semantic consistency, Rule of Two).

For domains with `/llms.txt` support (detectable via a lightweight HEAD request on opt-in), Sia suggests this as a cleaner ingestion path.

---

## 6. `sia_note` MCP Tool (Task 14.5)

### 6.1 Tool Interface

```typescript
interface SiaNoteInput {
  kind: 'Decision' | 'Convention' | 'Bug' | 'Solution' | 'Concept';
  name: string;
  content: string;
  tags?: string[];
  relates_to?: string[];    // file paths or node IDs → pertains_to edges
  template?: string;        // template name from .sia/templates/
  properties?: Record<string, unknown>;  // template-specific fields
  supersedes?: string;      // node ID of the node this one replaces
}

interface SiaNoteResult {
  node_id: string;
  kind: string;
  edges_created: number;
  template_used?: string;
}
```

### 6.2 Template System

Templates are YAML files in `.sia/templates/` that define structured fields for each node kind:

```yaml
# .sia/templates/adr.yaml
kind: Decision
fields:
  context:
    description: "What is the problem or situation?"
    required: true
  decision:
    description: "What was decided?"
    required: true
  consequences:
    description: "What are the implications?"
    required: false
  alternatives:
    description: "What was considered and rejected?"
    required: false
tags_prefix: ["adr"]
auto_relate: true  # scan content for code symbol mentions and create pertains_to edges
```

When `sia_note` is called with `template: 'adr'`, the `properties` field is validated against the template schema, the `tags_prefix` is prepended to the tags array, and if `auto_relate: true`, the content is scanned for known code symbol mentions to automatically create `pertains_to` edges.

### 6.3 Ontology Enforcement

`sia_note` routes all node creation through the ontology middleware (Task 14.1). This means:

- Creating a Convention without `relates_to` throws an OntologyError (cardinality constraint).
- Creating a Bug without specifying the caused_by target (via relates_to where the first entry is treated as the causal anchor) throws.
- Creating a Decision with `supersedes` validates that the superseded node is also a Decision (type-matching constraint).
- All edges are validated against the `edge_constraints` table before insertion.

---

## 7. `sia_backlinks` MCP Tool (Task 14.6)

### 7.1 Tool Interface

```typescript
interface SiaBacklinksInput {
  node_id: string;
  edge_types?: string[];   // filter to specific edge types; omit for all
}

interface SiaBacklinksResult {
  target: SiaSearchResult;  // the node whose backlinks were queried
  backlinks: {
    [edge_type: string]: SiaSearchResult[];  // grouped by incoming edge type
  };
  total_count: number;
}
```

### 7.2 Query Implementation

```sql
-- For a given target node, find all active incoming edges grouped by type
SELECT
  ge.type AS edge_type,
  gn.id, gn.kind, gn.name, gn.summary, gn.content, gn.tags,
  gn.importance, gn.confidence, gn.trust_tier
FROM graph_edges ge
JOIN graph_nodes gn ON gn.id = ge.from_id
WHERE ge.to_id = ?
  AND ge.t_valid_until IS NULL
  AND gn.t_valid_until IS NULL
  AND gn.archived_at IS NULL
ORDER BY ge.type, gn.importance DESC;
```

The results are grouped by `edge_type` in the application layer before returning. This gives the agent (and the developer, via CLI) a complete view of everything that references, modifies, depends on, or pertains to a given node — the graph-native equivalent of Obsidian's backlink panel, but with typed relationships.

---

## 8. Graph Visualization (Task 14.7)

### 8.1 Output Format

A self-contained HTML file using D3.js force-directed layout. All JavaScript and CSS are inlined (no external dependencies). The visualization is read-only — it is an exploration tool, not an editor.

### 8.2 Visual Encoding

Nodes are colored by kind category: structural nodes (CodeSymbol, FileNode, PackageNode) in blue, semantic nodes (Decision, Convention, Bug, Solution, Concept) in green, event nodes (EditEvent, ExecutionEvent, etc.) in amber, error nodes (ErrorEvent, Bug) in red, session nodes (SessionNode) in gray. Node size scales with importance score. Edge width scales with weight. Edge color reflects type category (structural = solid blue, semantic = dashed green, event = dotted amber).

### 8.3 Interactive Features

Filtering panel: toggle visibility by node kind, trust tier (1–4), time range (last 24h, 7d, 30d, all), and community. Search box: type a node name to highlight it and its neighborhood. Click a node: shows properties panel with kind, name, summary, trust tier, importance, timestamps, tags, and backlink count. Zoom/pan: standard D3 zoom behavior. Scope flag: `--scope src/auth/` limits the visualization to nodes connected to files in that path within 2 hops.

### 8.4 Subgraph Extraction

The visualization does not render the entire graph (which could have 50,000+ nodes). It extracts a relevant subgraph based on the scope:

- Default (no scope): top 200 nodes by importance, plus all edges between them.
- With `--scope <path>`: all FileNode/CodeSymbol nodes under that path, plus 2-hop neighbors, capped at 500 nodes.
- With `--kind <kind>`: all nodes of that kind, plus their direct neighbors, capped at 300 nodes.

---

## 9. Knowledge Digest (Task 14.8)

### 9.1 Digest Generation

The digest is assembled from parameterized graph queries covering the specified time period:

```typescript
interface DigestSection {
  title: string;
  query: string;  // the graph query that populates this section
  format: 'count_and_top3' | 'list' | 'pairs' | 'narrative';
}

const DIGEST_SECTIONS: DigestSection[] = [
  { title: 'Decisions Captured', query: 'kind=Decision, created_at >= period_start', format: 'count_and_top3' },
  { title: 'Conventions Established', query: 'kind=Convention, created_at >= period_start', format: 'count_and_top3' },
  { title: 'Bugs Identified', query: 'kind=Bug, created_at >= period_start', format: 'list' },
  { title: 'Bugs Resolved', query: 'kind=Solution, created_at >= period_start, has solves edge', format: 'pairs' },
  { title: 'Most Modified Files', query: 'kind=EditEvent, group by modifies→FileNode, top 10', format: 'list' },
  { title: 'Sessions', query: 'kind=SessionNode, created_at >= period_start', format: 'count_and_top3' },
  { title: 'Unresolved Errors', query: 'kind=ErrorEvent, no resolves edge, created_at >= period_start', format: 'list' },
  { title: 'Documentation Ingested', query: 'kind=FileNode, tag=ai-context OR project-docs, created_at >= period_start', format: 'list' },
  { title: 'Team Contributions', query: 'group by created_by, count nodes', format: 'list' },  // sync only
];
```

### 9.2 Output and Indexing

The digest is rendered as markdown to stdout (or to a file via `--output`). It is also indexed into the graph as a ContentChunk node tagged `["digest", "weekly"]` (or `["digest", "monthly"]` etc.), so the agent can find it via `sia_search`: "What happened this week?" → the weekly digest ContentChunk is returned.

---

## 10. Markdown Export/Import (Task 14.9)

### 10.1 Export Structure

```
sia-export/
├── index.md                    # Graph overview: node counts, top decisions, recent activity
├── decisions/
│   ├── dec-001-jwt-format.md   # One file per Decision node
│   └── dec-002-redis-cache.md
├── conventions/
│   ├── conv-001-error-handling.md
│   └── conv-002-repo-layer.md
├── bugs/
│   └── bug-001-token-expiry.md
├── solutions/
│   └── sol-001-refresh-token.md
├── concepts/
│   └── con-001-auth-architecture.md
└── code/
    ├── AuthService.md          # CodeSymbol summary with backlinks
    └── SessionManager.md
```

### 10.2 File Format

Each exported node becomes a markdown file with YAML frontmatter:

```markdown
---
id: dec-001
kind: Decision
trust_tier: 1
created_at: 2026-03-14T10:30:00Z
t_valid_from: 2026-03-14T10:30:00Z
tags: [authentication, jwt, adr]
importance: 0.85
---

# Use JWT RS256 for API Authentication

Chose RS256 over HS256 for JWT signing because the backend and frontend are separate
services that need to independently verify tokens without sharing a secret key.

## Related

- Pertains to: [[code/AuthService]]
- Pertains to: [[code/TokenValidator]]
- Supersedes: [[decisions/dec-000-session-cookies]]
- Elaborated by: [[conventions/conv-003-token-rotation]]
```

The `[[wikilinks]]` resolve to other files in the export directory, making the vault Obsidian-compatible.

### 10.3 Import and Round-Trip

`npx sia import --format markdown <directory>` reads the vault:

1. Parse YAML frontmatter for metadata (kind, trust_tier, tags, id).
2. Parse markdown content as the node's content field.
3. Resolve `[[wikilinks]]` to graph edges by matching export filenames to node IDs.
4. Run each node through the standard consolidation pipeline (ADD/UPDATE/INVALIDATE/NOOP) to merge changes with existing graph state.
5. Validate all edges through the ontology constraint layer.

This enables a round-trip workflow: export → edit in Obsidian → import back to Sia. Developers can curate knowledge in a familiar tool and have the changes reflected in the graph.

---

## 11. Documentation Freshness Tracking (Task 14.10)

### 11.1 Freshness Algorithm

For each DocumentNode that has `references` edges to CodeSymbol or FileNode nodes:

1. Get the document's last git modification date (`doc_modified`).
2. Get the most recent git modification date across all referenced code nodes (`code_modified`).
3. Compute `divergence_days = (code_modified - doc_modified) / 86_400_000`.
4. If `divergence_days > config.freshnessDivergenceThreshold` (default 90): tag the DocumentNode with `["potentially-stale"]` and apply a freshness penalty to its importance score.

### 11.2 Integration Points

The freshness check runs as part of the maintenance scheduler (startup catchup + idle). It also runs when a DocumentNode is accessed via `sia_search` or `sia_by_file` — real-time freshness verification.

The agent behavioral layer (CLAUDE.md) is updated to qualify stale documentation: when a search result includes a node tagged `potentially-stale`, the agent should say: "This documentation may be outdated — it was last updated [date], but the code it describes was modified [date]. I'll verify against the current code before applying it."

### 11.3 Configuration

```jsonc
// Added to ~/.sia/config.json
{
  "freshnessDivergenceThreshold": 90,  // days
  "freshnessPenalty": 0.15,            // subtracted from importance for stale docs
  "freshnessCheckOnAccess": true       // real-time check on retrieval
}
```

---

## 12. Directory Layout (Additions to ARCHI §13)

```
sia/
├── src/
│   ├── ontology/
│   │   ├── middleware.ts          # Typed factory methods, ontology enforcement
│   │   ├── constraints.ts        # Edge constraint definitions and validation
│   │   └── errors.ts             # OntologyError type
│   │
│   ├── knowledge/
│   │   ├── discovery.ts          # Priority-ordered file scanner
│   │   ├── ingest.ts             # Heading-based chunking + graph ingestion
│   │   ├── external-refs.ts      # External URL detection + ExternalRef nodes
│   │   ├── freshness.ts          # Git-based freshness tracking
│   │   ├── templates.ts          # .sia/templates/ loader and validator
│   │   └── patterns.ts           # File patterns for each discovery priority
│   │
│   ├── visualization/
│   │   ├── graph-renderer.ts     # D3.js HTML generation
│   │   ├── subgraph-extract.ts   # Scope-based subgraph extraction
│   │   └── template.html         # HTML template with inlined D3
│   │
│   ├── mcp/tools/
│   │   ├── sia-note.ts           # Developer-authored knowledge entry
│   │   └── sia-backlinks.ts      # Backlink traversal
│   │
│   └── cli/commands/
│       ├── graph.ts              # npx sia graph (visualization)
│       └── digest.ts             # npx sia digest
│
├── migrations/
│   └── graph/002_ontology.sql    # edge_constraints table + triggers
│
└── .sia/
    └── templates/                # User-defined knowledge templates
        └── adr.yaml              # Example ADR template
```

---

## 13. Migration Note (graph/002_ontology.sql)

The ontology migration adds the `edge_constraints` table and the three validation triggers. It also seeds the constraints table with all valid triples from the v5 ontology. This migration is additive and non-breaking — existing edges that happen to violate the new constraints are not retroactively rejected. However, a one-time validation scan (`npx sia doctor --ontology-check`) should be run after migration to identify and report any existing edges that violate the new constraints. These can be reviewed and corrected manually or auto-repaired by the doctor command.

```sql
-- migrations/graph/002_ontology.sql

CREATE TABLE IF NOT EXISTS edge_constraints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind TEXT NOT NULL,
  edge_type   TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  description TEXT,
  cardinality TEXT DEFAULT 'many-to-many',
  required    INTEGER DEFAULT 0,
  UNIQUE(source_kind, edge_type, target_kind)
);

-- [INSERT statements from §2.2 above]

-- [CREATE TRIGGER statements from §2.3 above]
```

---

## 14. Agent Behavioral Updates

The CLAUDE.md base module and relevant playbooks receive the following updates for Phase 14:

**Step 0 — Sandbox routing** gains documentation awareness: when the developer asks about a convention, architecture decision, or project structure, the agent checks whether relevant documentation has been ingested (via `sia_search` with `tags: ["ai-context"]` or `tags: ["architecture"]`) before reading raw files.

**Step 2 — Evaluate Results** gains freshness qualification: when a search result includes a node tagged `potentially-stale`, the agent qualifies it: "This documentation may be outdated — last updated [date], code modified [date]. Let me verify against current code."

**Invariant 8** is expanded: "Always prefer sandbox tools over raw file reads for content > 5 KB. For documentation files already ingested into the graph, prefer `sia_search` over reading the raw file — the graph has already chunked, indexed, and cross-referenced the content."

**sia-tools.md** gains documentation for `sia_note` and `sia_backlinks` with full parameter reference and usage guidance.
