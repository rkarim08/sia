#!/usr/bin/env bash
# Stop hook — detects uncaptured knowledge patterns before session ends
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

source "$PLUGIN_ROOT/scripts/ensure-runtime.sh" "$PLUGIN_ROOT"

exec bun run "$PLUGIN_ROOT/src/hooks/plugin-stop.ts" 2>/dev/null
