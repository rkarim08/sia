#!/usr/bin/env bash
# PostToolUse hook — captures knowledge from Write/Edit events
# Receives hook event data on stdin as JSON
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

# Pass stdin through to the handler
exec bun run "$PLUGIN_ROOT/src/hooks/plugin-post-tool-use.ts" 2>/dev/null
