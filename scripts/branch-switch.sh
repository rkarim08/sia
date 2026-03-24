#!/usr/bin/env bash
# Branch switch detection hook
# stderr is redirected to a log file so diagnostics from the TypeScript
# handler are preserved for debugging (not discarded via /dev/null).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

SIA_LOG_DIR="${CLAUDE_PLUGIN_DATA:-${HOME}/.sia}/logs"
mkdir -p "$SIA_LOG_DIR"

exec bun run "$PLUGIN_ROOT/src/hooks/plugin-branch-switch.ts" 2>>"${SIA_LOG_DIR}/hooks.log"
