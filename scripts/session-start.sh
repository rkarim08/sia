#!/usr/bin/env bash
# SessionStart hook — injects recent decisions/conventions/bugs as context
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

exec bun run "$PLUGIN_ROOT/src/hooks/plugin-session-start.ts" 2>/dev/null
