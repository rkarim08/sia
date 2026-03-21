#!/usr/bin/env bash
# PreCompact hook — scans transcript tail for unextracted knowledge before context compaction
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

exec bun run "$PLUGIN_ROOT/src/hooks/plugin-pre-compact.ts" 2>/dev/null
