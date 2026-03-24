#!/usr/bin/env bash
# Branch switch detection hook
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

exec bun run "$PLUGIN_ROOT/src/hooks/plugin-branch-switch.ts" 2>/dev/null
