#!/usr/bin/env bash
# PostCompact hook — logs compaction coverage info for observability
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

exec bun run "$PLUGIN_ROOT/src/hooks/plugin-post-compact.ts" 2>/dev/null
