# Phase 16 — Hooks-First Knowledge Capture + Pluggable LLM Fallback
## Sia v5 — Full Implementation Specification

**Version:** 2.0
**Status:** Draft
**Last Updated:** 2026-03-17
**Dependency:** Requires Phase 4 (capture pipeline) complete. Can begin in parallel with Phases 14–15.
**Estimated effort:** 42–54 hours across 10 tasks
**Architecture:** Three-layer hybrid — Claude Code hooks (primary, zero LLM cost) → CLAUDE.md behavioral directives (proactive, zero LLM cost) → Vercel AI SDK pluggable provider (fallback for offline operations and non-Claude-Code agents).

---

## 1. Overview: Why Hooks Change Everything

The original Phase 16 design treated Sia's LLM extraction as a standalone pipeline: intercept session transcripts, send them to a separate LLM (Haiku, GPT-4o-mini, or Ollama), and parse structured entities from the response. This works, but it's architecturally backwards for a Claude Code plugin. Claude Code is already the LLM doing the work — it already understands every decision it makes, every file it writes, every bug it encounters. Making a separate API call to a second LLM to re-analyze what Claude Code already understood is like hiring a stenographer to transcribe a meeting that's already being recorded.

Claude Code's hook system exposes 17 lifecycle events with full tool I/O access. PostToolUse delivers the exact content written, the exact command output, the exact file read — everything the extraction pipeline needs, delivered at the moment it happens, at zero additional LLM cost. The hooks fire deterministically (not probabilistically like CLAUDE.md instructions), run as HTTP POST requests or shell commands, and can communicate directly with Sia's MCP server.

The research validated this approach: Claude-Mem and Sage, two existing Claude Code memory plugins, already use this pattern for knowledge capture in production.

### Cost Impact

Under the original pure-API approach, a moderately active day costs ~$0.36–0.45 in extraction API calls (100 Haiku calls at ~$0.0036 each). Under the hooks-first approach, real-time extraction costs $0 — the only LLM spend is community summarization (~$0.02/day) and occasional Stop hook prompt calls (~$0.005/day for ambiguous cases). That's a ~90% cost reduction with richer knowledge capture because hooks observe at the moment of maximum context.

---

## 2. Three-Layer Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 1: Claude Code Hooks (real-time, deterministic, $0)    │
│                                                              │
│  PostToolUse ──→ Extract knowledge from every tool operation │
│  Stop ──────→ Process transcript for missed knowledge       │
│  PreCompact ──→ Snapshot graph state before compaction      │
│  SessionStart → Inject graph context into new sessions      │
│  SessionEnd ──→ Finalize session knowledge                  │
│                                                              │
│  Fires for: Write, Edit, Bash, Read, MCP tools, Git ops     │
│  Data: full tool_input + tool_response (complete I/O)        │
│  Cost: $0 (no LLM calls — deterministic extraction rules)    │
├──────────────────────────────────────────────────────────────┤
│ Layer 2: CLAUDE.md Behavioral Directives (proactive, $0)     │
│                                                              │
│  Claude calls sia_note when it makes decisions               │
│  Claude calls sia_flag when it finds bugs                    │
│  Claude calls sia_search before starting tasks               │
│                                                              │
│  Captures: reasoning, alternatives, context (the "why")      │
│  Cost: $0 (Claude is already reasoning — no extra LLM call)  │
├──────────────────────────────────────────────────────────────┤
│ Layer 3: Pluggable LLM Provider (offline + fallback)         │
│                                                              │
│  Community summarization (Sonnet — requires full-graph view) │
│  Deep validation (Haiku/Ollama — maintenance sweep)     │
│  Batch extraction (api mode — npx sia reindex, CLI ops)      │
│  Non-Claude-Code agents (Cursor, Windsurf, Cline fallback)   │
│                                                              │
│  Foundation: Vercel AI SDK + Zod schemas                     │
│  Providers: Anthropic, OpenAI, Google, Ollama, Claude Code   │
│  Cost: ~$0.02–0.05/day (only summarize + validate roles)     │
└──────────────────────────────────────────────────────────────┘
```

### When Each Layer Fires

**During a Claude Code session:** Layer 1 (hooks) handles all real-time extraction. Layer 2 (CLAUDE.md) makes Claude proactively document decisions. Layer 3 is dormant except for community summarization.

**During offline operations** (`npx sia reindex`, `npx sia digest`, maintenance sweeps): Layer 3 (LLM provider) handles everything. Layers 1 and 2 are inactive (no Claude Code session).

**With non-Claude-Code agents** (Cursor, Cline, Windsurf): Layer 1 uses the agent's native hook system via adapters (Cursor and Cline have comparable hooks). Layer 2 uses equivalent instruction files (`.cursorrules`, `.clinerules`). Layer 3 handles anything hooks can't reach.

---

## 3. Hook Event Router (Task 16.1)

### 3.1 HTTP Endpoint Design

Sia's MCP server exposes hook endpoints alongside its MCP stdio transport:

```typescript
// src/hooks/event-router.ts

import { serve } from 'bun';

const HOOK_HANDLERS: Record<string, (event: HookEvent) => Promise<HookResponse>> = {
  'post-tool-use':  handlePostToolUse,
  'stop':           handleStop,
  'pre-compact':    handlePreCompact,
  'post-compact':   handlePostCompact,
  'session-start':  handleSessionStart,
  'session-end':    handleSessionEnd,
};

// HTTP server for hook events (runs alongside MCP stdio server)
serve({
  port: 4521,  // configurable via SIA_HOOK_PORT env var
  async fetch(req) {
    const url = new URL(req.url);
    const hookName = url.pathname.split('/hooks/')[1];
    const handler = HOOK_HANDLERS[hookName];
    if (!handler) return new Response('Unknown hook', { status: 404 });

    const event: HookEvent = await req.json();
    const response = await handler(event);
    return Response.json(response);
  },
});
```

### 3.2 Hook Event Schema

Every hook receives a JSON envelope from Claude Code:

```typescript
interface HookEvent {
  session_id: string;
  transcript_path: string;       // path to full JSONL transcript
  cwd: string;
  hook_event_name: string;       // 'PostToolUse', 'Stop', 'PreCompact', etc.
  permission_mode: string;

  // Tool-specific fields (PostToolUse, PreToolUse)
  tool_name?: string;            // 'Write', 'Bash', 'Edit', 'Read', 'mcp__sia__search'
  tool_input?: Record<string, any>;
  tool_response?: any;           // full tool output — the critical field for extraction
  tool_use_id?: string;

  // Compaction-specific fields
  trigger?: 'auto' | 'manual';
  compact_summary?: string;      // PostCompact only
  custom_instructions?: string;

  // Session-specific fields
  source?: 'startup' | 'resume' | 'clear';
  reason?: 'exit' | 'sigint' | 'error';
}
```

### 3.3 Hook Installation

`npx sia install` writes hook configuration to `.claude/settings.json`. PostToolUse hooks run async (non-blocking — Claude continues immediately). Stop and PreCompact hooks run sync (Sia must finish processing before Claude proceeds). SessionStart uses a command hook because it must write to stdout to inject context into Claude's conversation.

```json
{
  "hooks": {
    "PostToolUse": [{
      "type": "http",
      "url": "http://localhost:4521/hooks/post-tool-use",
      "timeout": 5000,
      "async": true
    }],
    "Stop": [{
      "type": "http",
      "url": "http://localhost:4521/hooks/stop",
      "timeout": 10000
    }],
    "PreCompact": [{
      "type": "http",
      "url": "http://localhost:4521/hooks/pre-compact",
      "timeout": 5000
    }],
    "PostCompact": [{
      "type": "http",
      "url": "http://localhost:4521/hooks/post-compact",
      "timeout": 5000,
      "async": true
    }],
    "SessionStart": [{
      "type": "command",
      "command": "npx sia hook session-start"
    }],
    "SessionEnd": [{
      "type": "http",
      "url": "http://localhost:4521/hooks/session-end",
      "timeout": 5000,
      "async": true
    }]
  }
}
```

---

## 4. PostToolUse Knowledge Extractor (Task 16.2)

### 4.1 Deterministic Extraction Rules

The PostToolUse handler applies tool-specific extraction rules with zero LLM calls. This handler is the workhorse of Sia's knowledge capture — it fires on every tool operation Claude performs and receives full I/O.

```typescript
// src/hooks/handlers/post-tool-use.ts

async function handlePostToolUse(event: HookEvent): Promise<HookResponse> {
  const { tool_name, tool_input, tool_response, session_id } = event;

  switch (tool_name) {
    case 'Write':
      // Full file path + content written → FileNode, AST extraction, EditEvent
      return handleWrite(tool_input.file_path, tool_input.content, session_id);

    case 'Edit':
    case 'MultiEdit':
      // File path + old_string + new_string → EditEvent, AST diff, symbol rename detection
      return handleEdit(tool_input, session_id);

    case 'Bash':
      // Command + exit code + output → ExecutionEvent, ErrorEvent, GitEvent
      return handleBash(tool_input.command, tool_response, session_id);

    case 'Read':
      // File path + content read → SearchEvent for importance boosting (no graph mutation)
      return handleRead(tool_input.file_path, session_id);

    default:
      // MCP tool calls (sia_search, sia_note, etc.) → log as SearchEvent
      if (tool_name?.startsWith('mcp__sia__')) {
        return handleSiaMcpCall(tool_name, tool_input, tool_response, session_id);
      }
      return { status: 'skipped' };
  }
}
```

### 4.2 Write Handler — The Core Extraction Path

```typescript
async function handleWrite(filePath: string, content: string, sessionId: string) {
  // 1. Create or update the FileNode in the graph
  await upsertFileNode(filePath, sessionId);

  // 2. Trigger Tree-sitter AST extraction for CodeSymbol nodes
  //    This feeds directly into the freshness engine (Phase 15 Layer 1)
  await triggerAstExtraction(filePath, content);

  // 3. Create an EditEvent node with 'modifies' edge to the FileNode
  await createEditEvent(filePath, 'write', sessionId);

  // 4. Scan content for deterministic knowledge patterns (no LLM needed)
  const patterns = detectKnowledgePatterns(content);
  for (const pattern of patterns) {
    // Each pattern becomes a graph node with appropriate edges
    await createKnowledgeNode(pattern, filePath, sessionId);
  }

  return { status: 'processed', nodes_created: patterns.length + 1 };
}
```

### 4.3 Knowledge Pattern Detection (Zero LLM)

```typescript
// src/hooks/extractors/pattern-detector.ts

const KNOWLEDGE_PATTERNS = [
  // Decision patterns found in code comments
  { regex: /(?:we\s+decided|decision:|chose\s+\w+\s+over|trade-?off:)/i,
    kind: 'Decision' as const },

  // Convention patterns
  { regex: /(?:convention:|always\s+use|never\s+use|must\s+be|should\s+always)/i,
    kind: 'Convention' as const },

  // Bug and workaround patterns
  { regex: /(?:BUG:|FIXME:|HACK:|WORKAROUND:|known\s+issue)/i,
    kind: 'Bug' as const },

  // Task and improvement patterns
  { regex: /(?:TODO:|XXX:|OPTIMIZE:|REFACTOR:)/i,
    kind: 'Concept' as const },
];

// Git conventional commit patterns (for Bash handler when detecting git commit)
const GIT_COMMIT_PATTERNS = [
  { regex: /^fix(?:\(.*?\))?:/i, kind: 'Solution' as const },
  { regex: /^feat(?:\(.*?\))?:/i, kind: 'Decision' as const },
  { regex: /^refactor(?:\(.*?\))?:/i, kind: 'Decision' as const },
  { regex: /^breaking(?:\(.*?\))?:/i, kind: 'Decision' as const },
];
```

### 4.4 Bash Handler — Execution, Errors, and Git

```typescript
async function handleBash(command: string, response: any, sessionId: string) {
  const exitCode = response?.exit_code ?? 0;
  const output = response?.output ?? '';

  // Detect git operations
  if (command.startsWith('git ')) {
    return handleGitCommand(command, output, exitCode, sessionId);
  }

  // Create ExecutionEvent
  await createExecutionEvent(command, exitCode, sessionId);

  // Detect test results
  if (isTestCommand(command)) {
    const testResults = parseTestOutput(output, command);
    if (testResults.failures > 0) {
      // Create ErrorEvent nodes for each test failure
      for (const failure of testResults.failedTests) {
        await createErrorEvent(failure, sessionId);
      }
    }
  }

  // Detect failed commands as potential ErrorEvents
  if (exitCode !== 0) {
    await createErrorEvent({ command, output, exitCode }, sessionId);
  }

  return { status: 'processed' };
}
```

This deterministic extraction handles ~60–70% of knowledge capture. The remaining 30–40% (decisions in natural language, architectural reasoning, implicit conventions) is caught by the Stop hook and CLAUDE.md directives.

---

## 5. Stop Hook Session Processor (Task 16.3)

The Stop hook fires when Claude finishes a response. It reads the recent transcript segment and identifies knowledge that PostToolUse couldn't capture — primarily Claude's reasoning and decisions expressed in natural language rather than tool operations.

For semantic analysis of ambiguous transcript content, the Stop hook uses Claude Code's built-in **prompt hook type** as a lightweight Haiku call integrated into the hook system. This costs ~$0.001 per invocation and only fires when the Stop event triggers — not on every tool call.

```typescript
// src/hooks/handlers/stop.ts

async function handleStop(event: HookEvent): Promise<HookResponse> {
  // Read only the transcript segment since the last Stop event
  const recentSegment = await readTranscriptSince(
    event.transcript_path,
    event.session_id,
    lastStopTimestamp
  );

  // Check if Claude made any sia_note calls in this segment
  // (CLAUDE.md directives may have already captured the knowledge)
  const siaCalls = recentSegment.filter(msg =>
    msg.tool_name?.startsWith('mcp__sia__note') ||
    msg.tool_name?.startsWith('mcp__sia__flag')
  );

  // If Claude already captured knowledge via MCP tools, we're done
  if (siaCalls.length > 0) {
    return { status: 'already_captured', sia_calls: siaCalls.length };
  }

  // Otherwise, check for uncaptured decisions/conventions in assistant messages
  const assistantMessages = recentSegment
    .filter(msg => msg.role === 'assistant' && msg.type === 'text')
    .map(msg => msg.content);

  // Quick heuristic check — does the text contain decision/convention language?
  const hasUncapturedKnowledge = assistantMessages.some(msg =>
    KNOWLEDGE_PATTERNS.some(p => p.regex.test(msg))
  );

  if (hasUncapturedKnowledge) {
    // Queue for the companion prompt hook to analyze semantically
    // The prompt hook (configured in .claude/settings.json) will
    // call Haiku to extract the specific knowledge
    return {
      status: 'needs_semantic_analysis',
      segment_length: assistantMessages.length,
    };
  }

  return { status: 'no_new_knowledge' };
}
```

---

## 6. Session Lifecycle Handlers (Task 16.4)

### 6.1 SessionStart — Context Injection via Stdout

```typescript
// src/hooks/handlers/session-start.ts
// Invoked as command hook: npx sia hook session-start
// Must write to stdout — content becomes part of Claude's conversation context

const event: HookEvent = JSON.parse(await Bun.stdin.text());

// Query the graph for context relevant to the working directory
const recentDecisions = await queryGraph('kind=Decision, scope=cwd, limit=5');
const activeConventions = await queryGraph('kind=Convention, active=true, scope=cwd');
const unresolvedErrors = await queryGraph('kind=ErrorEvent, unresolved=true, limit=3');
const staleDocWarnings = await queryGraph('tag=potentially-stale, scope=cwd, limit=3');

// Format as a concise context block
const context = formatSessionContext({
  decisions: recentDecisions,
  conventions: activeConventions,
  errors: unresolvedErrors,
  warnings: staleDocWarnings,
  resuming: event.source === 'resume',
});

// Write to stdout — Claude Code injects this into the conversation
console.log(JSON.stringify({
  additionalContext: context,
}));
```

### 6.2 PreCompact — Knowledge Snapshot

```typescript
// src/hooks/handlers/pre-compact.ts

async function handlePreCompact(event: HookEvent): Promise<HookResponse> {
  // Read the full transcript before it gets compacted
  const transcript = await Bun.file(event.transcript_path).text();

  // Final extraction pass — catch anything the PostToolUse/Stop hooks missed
  await processTranscriptForKnowledge(transcript, event.session_id);

  // Snapshot the session's graph state for post-compaction comparison
  const snapshot = await captureSessionSnapshot(event.session_id);
  await Bun.write(
    `.sia/session-snapshots/${event.session_id}.json`,
    JSON.stringify(snapshot)
  );

  return { status: 'processed', snapshot_nodes: snapshot.nodeCount };
}
```

### 6.3 PostCompact — Gap Detection

```typescript
// src/hooks/handlers/post-compact.ts

async function handlePostCompact(event: HookEvent): Promise<HookResponse> {
  // Read the compacted summary to see what Claude will remember
  const summary = event.compact_summary ?? '';

  // Load the pre-compaction snapshot for comparison
  const snapshot = await loadSessionSnapshot(event.session_id);

  // Identify knowledge that was in the graph but may not be in the compacted summary
  // (This is informational — the graph already has the knowledge from PreCompact)
  const preserved = analyzeCompactionCoverage(snapshot, summary);

  logger.info(`Compaction preserved ${preserved.percentage}% of session knowledge`);

  return { status: 'processed', preserved_percentage: preserved.percentage };
}
```

---

## 7. CLAUDE.md Behavioral Directives (Task 16.5)

These directives make Claude proactively call Sia's MCP tools when making decisions. They capture the "why" — reasoning, alternatives, and context that deterministic hooks can't extract from tool I/O alone. The directives are additive to hook-based capture: even if Claude forgets to call `sia_note`, the PostToolUse and Stop hooks catch the structural knowledge deterministically.

```markdown
## Sia Knowledge Management

When you make decisions during coding:
- After choosing between architectural alternatives, call mcp__sia__note with
  kind='Decision', including your reasoning and the alternatives you considered.
- When you establish or recognize a coding pattern the team should follow,
  call mcp__sia__note with kind='Convention'.
- When you discover a bug's root cause, call mcp__sia__note with kind='Bug'
  and reference the affected files.
- When you fix a bug, call mcp__sia__note with kind='Solution' and reference
  the Bug it resolves.

Before starting work:
- Call mcp__sia__search to check for relevant prior knowledge about the files
  and symbols you'll be working with.

These calls help build persistent memory that survives across sessions.
You don't need to capture every small edit — focus on decisions, patterns,
and discoveries that a future developer (or your future self) would want to know.
```

---

## 8. Pluggable LLM Provider Layer (Tasks 16.6–16.7)

### 8.1 Reduced Scope

With hooks handling real-time extraction, the pluggable LLM layer serves a narrower but still essential set of operations: community summarization (requires full-graph reasoning), deep validation (maintenance sweep — startup catchup or idle processing), batch extraction (`npx sia reindex`, CLI operations), and non-Claude-Code agent fallback.

The implementation uses the Vercel AI SDK with Zod schemas as the single source of truth. The `extract` and `consolidate` roles are standby — only activated when `capture.mode` is `api` or `hybrid`.

### 8.2 Provider Registry

```typescript
// src/llm/provider-registry.ts

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export type OperationRole = 'extract' | 'consolidate' | 'summarize' | 'validate';

export class ProviderRegistry {
  private models: Map<OperationRole, LanguageModel> = new Map();
  private captureMode: 'hooks' | 'api' | 'hybrid';

  // In hooks mode, extract and consolidate roles are dormant
  // Only summarize and validate make LLM calls
  isRoleActive(role: OperationRole): boolean {
    if (this.captureMode === 'api') return true;
    if (this.captureMode === 'hooks') return role === 'summarize' || role === 'validate';
    if (this.captureMode === 'hybrid') return true; // all roles active in hybrid
    return false;
  }

  getModel(role: OperationRole): LanguageModel {
    const model = this.models.get(role);
    if (!model) throw new Error(`No model configured for role: ${role}`);
    return model;
  }
}
```

### 8.3 Configuration with Capture Mode

```yaml
# sia.config.yaml
version: 2

capture:
  mode: hooks              # hooks | api | hybrid
  hookPort: 4521           # HTTP port for hook event receiver

providers:
  summarize:
    provider: anthropic
    model: claude-sonnet-4
  validate:
    provider: ollama
    model: qwen2.5-coder:7b
  extract:                  # only active in api/hybrid mode
    provider: anthropic
    model: claude-haiku-4-5
  consolidate:              # only active in api/hybrid mode
    provider: anthropic
    model: claude-haiku-4-5

fallback:
  enabled: true
  maxRetries: 3
  chain: [anthropic, openai, ollama]

costTracking:
  enabled: true
  budgetPerDay: 1.00        # much lower budget in hooks mode (~$0.04/day actual)
  logFile: .sia/cost-log.jsonl
```

### 8.4 Zod Schemas (Shared Across Hooks and LLM Layer)

The Zod schemas serve as the single source of truth for structured knowledge. Both the hook extractors and the LLM provider produce objects conforming to the same schemas, ensuring the downstream consolidation pipeline is identical regardless of capture source.

```typescript
// src/llm/schemas.ts — used by BOTH hooks/extractors AND llm/provider-registry

export const SiaExtractionResult = z.object({
  entities: z.array(z.object({
    kind: z.enum(['Decision', 'Convention', 'Bug', 'Solution', 'Concept']),
    name: z.string().min(3).max(200),
    content: z.string().min(10).max(2000),
    confidence: z.number().min(0).max(1),
    tags: z.array(z.string()).max(5),
    relates_to: z.array(z.string()),
  })),
  _meta: z.object({
    source: z.enum(['hook', 'llm', 'claude-directive']),
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
  }).optional(),
});

// SiaConsolidationResult, SiaSummaryResult, SiaValidationResult
// identical to original Phase 16 design — see §3 of original spec
```

### 8.5 Reliability Layer

The `reliableGenerateObject()` wrapper with retry, fallback chain, circuit breaker, and `json-repair` is identical to the original Phase 16 design. It wraps all `generateObject()` calls regardless of provider.

---

## 9. Cross-Agent Portability (Task 16.9)

### 9.1 Adapter Architecture

```
src/hooks/adapters/
├── claude-code.ts     # Native — direct HTTP/command hook integration
├── cursor.ts          # Maps afterFileEdit → PostToolUse, afterModelResponse → Stop
├── cline.ts           # Nearly 1:1 with Claude Code (same event names, JSON protocol)
└── generic.ts         # MCP-only fallback — api capture mode, no hooks
```

Each adapter normalizes the agent's hook events into Sia's `HookEvent` interface. The PostToolUse handler receives the same `tool_name`, `tool_input`, `tool_response` structure regardless of which agent generated the event.

### 9.2 Agent Detection and Auto-Configuration

```typescript
// src/hooks/agent-detect.ts

export function detectAgent(cwd: string): 'claude-code' | 'cursor' | 'cline' | 'generic' {
  if (existsSync(join(cwd, '.claude'))) return 'claude-code';
  if (existsSync(join(cwd, '.cursor'))) return 'cursor';
  if (existsSync(join(cwd, '.clinerules'))) return 'cline';
  return 'generic';
}
```

`npx sia install` uses agent detection to install the correct hook configuration and set the appropriate capture mode in `sia.config.yaml`. For Claude Code, it installs HTTP hooks and sets `capture.mode: hooks`. For Cursor/Cline, it installs equivalent hooks via their systems. For generic (Windsurf, Aider), it sets `capture.mode: api`.

---

## 10. Directory Layout (Additions to ARCHI §13)

```
sia/
├── src/
│   ├── hooks/
│   │   ├── event-router.ts            # HTTP server + command handler dispatch
│   │   ├── handlers/
│   │   │   ├── post-tool-use.ts       # Core: extract from every tool operation
│   │   │   ├── stop.ts                # Process transcript for missed knowledge
│   │   │   ├── pre-compact.ts         # Snapshot graph state before compaction
│   │   │   ├── post-compact.ts        # Compare against snapshot
│   │   │   ├── session-start.ts       # Inject context (command hook → stdout)
│   │   │   └── session-end.ts         # Finalize session metadata
│   │   ├── extractors/
│   │   │   ├── pattern-detector.ts    # Deterministic knowledge patterns (zero LLM)
│   │   │   ├── write-extractor.ts     # Write tool → FileNode + AST
│   │   │   ├── bash-extractor.ts      # Bash tool → Execution/Error/GitEvent
│   │   │   └── edit-extractor.ts      # Edit tool → EditEvent + AST diff
│   │   └── adapters/
│   │       ├── claude-code.ts         # Native hook integration
│   │       ├── cursor.ts              # Cursor hook normalization
│   │       ├── cline.ts               # Cline hook normalization
│   │       └── generic.ts             # MCP-only fallback (api mode)
│   │
│   └── llm/
│       ├── provider-registry.ts       # Vercel AI SDK provider management
│       ├── config.ts                  # sia.config.yaml loader + capture mode
│       ├── schemas.ts                 # Zod schemas (shared by hooks AND LLM layer)
│       ├── reliability.ts             # reliableGenerateObject(), retry, fallback
│       ├── circuit-breaker.ts         # Per-provider circuit breaker
│       ├── cost-tracker.ts            # Per-call cost logging + budget enforcement
│       └── prompts/
│           ├── summarization.ts       # Community summarization prompt
│           ├── validation.ts          # Deep validation prompt
│           ├── extraction.ts          # Batch extraction prompt (api mode only)
│           └── context-adapter.ts     # Context window adaptation
│
├── .claude/
│   └── settings.json                  # Hook configuration (installed by npx sia install)
│
└── .sia/
    ├── config.yaml                    # Provider + capture mode configuration
    ├── cost-log.jsonl                 # Per-call cost tracking
    └── session-snapshots/             # PreCompact graph state snapshots
```

---

## 11. Impact on Earlier Phases

**Phase 4 (Capture Pipeline):** Track B extraction becomes the fallback path, not the primary. In hooks mode, PostToolUse + Stop hooks replace Track B for Claude Code sessions. Track B remains active in api mode for non-Claude-Code agents and batch operations. The consolidation pipeline is unchanged — it receives `SiaExtractionResult` objects from either hooks or LLM calls.

**Phase 15 (Freshness Engine):** Layer 5 deep validation uses the `validate` role from the pluggable LLM provider (typically Ollama for zero-cost maintenance runs — startup catchup or idle). Unchanged from original design.

**Phase 9 (Community Detection & RAPTOR):** Community summarization uses the `summarize` role (typically Sonnet). Unchanged — summarization requires full-graph reasoning that hooks cannot provide.

**Key architectural invariant:** No code outside `src/llm/` and `src/hooks/` should know which capture mechanism produced the knowledge. The consolidation pipeline, ontology middleware, and graph storage layer all receive the same Zod-typed objects regardless of source.
