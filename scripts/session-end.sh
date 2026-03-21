#!/usr/bin/env bash
# SessionEnd hook — records session statistics and entity counts
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

exec bun run "$PLUGIN_ROOT/src/hooks/plugin-session-end.ts" 2>/dev/null
