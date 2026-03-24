#!/usr/bin/env bash
# UserPromptSubmit hook — captures user prompts and detects correction/preference patterns
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

source "$PLUGIN_ROOT/scripts/ensure-runtime.sh" "$PLUGIN_ROOT"

exec bun run "$PLUGIN_ROOT/src/hooks/plugin-user-prompt-submit.ts" 2>/dev/null
