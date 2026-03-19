// Module: claude-md-directives — Behavioral directives for proactive knowledge capture
//
// This string constant is injected into CLAUDE.md to guide the agent toward
// capturing decisions, conventions, bugs, and solutions during coding sessions.

/**
 * CLAUDE.md behavioral directives that instruct the agent to proactively
 * capture knowledge into Sia's persistent graph memory.
 *
 * Include this block in the project's CLAUDE.md to enable session-aware
 * knowledge capture.
 */
export const KNOWLEDGE_DIRECTIVES = `## Sia Knowledge Management

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
`;
