# `hooks/` — Claude Code Hook Registrations

This directory contains `hooks.json`, which registers every hook handler the
Sia plugin attaches to Claude Code's lifecycle. The actual handler scripts live
in [`../scripts/`](../scripts/) (shell wrappers) and
[`../src/hooks/`](../src/hooks/) (TypeScript handlers).

End users do not invoke hooks directly — they fire automatically. This file is
for contributors who need to add, modify, or debug a hook.

## Event matrix

Current registrations (see [`hooks.json`](hooks.json) for the source of truth):

| Event             | Matcher           | Handler                              | Timeout | Purpose                                             |
|-------------------|-------------------|--------------------------------------|---------|-----------------------------------------------------|
| PreToolUse        | `Grep\|Glob\|Bash` | `src/hooks/augment-hook.ts`          | 7s      | Enrich tool calls with graph context                |
| PreToolUse        | `""` (all)        | `scripts/pre-tool-use.sh`            | 3s      | Nous PreToolUse significance signal                 |
| PostToolUse       | `Write\|Edit\|Read` | `scripts/post-tool-use.sh`          | 5s      | Capture knowledge from file changes; file-read context |
| PostToolUse       | `Bash`            | `scripts/branch-switch.sh`           | 10s     | Detect branch switches; save/restore graph snapshots |
| Stop              | `""`              | `scripts/stop-hook.sh`               | 10s     | Detect uncaptured knowledge patterns                |
| SessionStart      | `""`              | `scripts/session-start.sh`           | 5s      | Inject recent decisions and conventions             |
| PreCompact        | `""`              | `scripts/pre-compact.sh`             | 10s     | Extract knowledge before context compaction        |
| SessionEnd        | `""`              | `scripts/session-end.sh`             | 10s     | Record session statistics and entity counts        |
| UserPromptSubmit  | `""`              | `scripts/user-prompt-submit.sh`      | 5s      | Capture prompts; detect correction/preference patterns |

PreToolUse registers **two** parallel handlers intentionally (see the `_comment`
at the top of `hooks.json`). Do not collapse them.

## Handler conventions

- **Shell wrappers** (`scripts/*.sh`) are thin: they set up environment variables,
  locate bun, and `exec` the TypeScript handler. Keep logic out of the wrapper.
- **TypeScript handlers** (`src/hooks/*.ts`) take the hook event JSON on stdin,
  perform work, and exit. They must never block indefinitely — always respect the
  declared timeout.
- **Exit codes** — non-zero exit aborts the tool call for PreToolUse hooks. Only
  return non-zero when the hook intends to block. Log to stderr; return 0 by default.
- **Data paths** — read/write under `${SIA_HOME}` / `${CLAUDE_PLUGIN_DATA}`.
  Never write to `${CLAUDE_PLUGIN_ROOT}` (it's read-only in user installs).
- **Portability** — use `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}`,
  never hard-coded paths. The validator
  (`bash scripts/validate-plugin.sh`) catches portability violations.

## Timeout guidance

Picking a timeout is a tradeoff between correctness and UX. Guidelines:

- **PreToolUse** — keep under 7s. The user is waiting for a tool call to run.
  Prefer to degrade gracefully (skip augmentation) rather than stall the tool.
- **PostToolUse** — up to 10s is acceptable for batch captures; typical hooks finish in under 5s.
- **Stop / SessionEnd / PreCompact** — up to 10s. The session is already ending or pausing;
  the user is less sensitive here.
- **If a handler can't reliably complete in its budget**, move work to a background
  process or offload to the next session's SessionStart. Never raise a timeout to "fix" flakiness.

## Adding a new hook

1. Decide the event and matcher (see the Claude Code hook reference for supported events).
2. Add the registration to `hooks.json`. The validator enforces that every
   registered handler actually exists on disk.
3. Create the handler script (ideally a shell wrapper + TS handler pair).
4. Add a unit test under [`../tests/hooks/`](../tests/hooks/) exercising the handler with representative stdin.
5. Run `bash scripts/validate-plugin.sh` and `bun run test`.
6. Update this file's event matrix.

## Related directories

- [`../scripts/`](../scripts/) — shell wrappers invoked by `hooks.json`.
- [`../src/hooks/`](../src/hooks/) — TypeScript handlers.
- [`../tests/hooks/`](../tests/hooks/) — hook unit and integration tests.
