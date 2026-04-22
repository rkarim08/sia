#!/usr/bin/env bash
# PostToolUse hook — emits a systemMessage recommending
# @sia-knowledge-capture dispatch when a successful (non-amend)
# `git commit` is detected on the Bash tool.
#
# stderr is redirected to the shared hooks log so diagnostics are
# preserved for debugging.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

source "$PLUGIN_ROOT/scripts/ensure-runtime.sh" "$PLUGIN_ROOT"

SIA_LOG_DIR="${CLAUDE_PLUGIN_DATA:-${HOME}/.sia}/logs"
mkdir -p "$SIA_LOG_DIR"

exec bun run "$PLUGIN_ROOT/src/hooks/plugin-commit-capture-dispatch.ts" 2>>"${SIA_LOG_DIR}/hooks.log"
