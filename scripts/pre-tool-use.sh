#!/usr/bin/env bash
# PreToolUse hook — Nous significance detector
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

source "$PLUGIN_ROOT/scripts/ensure-runtime.sh" "$PLUGIN_ROOT"

exec bun run "$PLUGIN_ROOT/src/hooks/plugin-pre-tool-use.ts" 2>/dev/null
