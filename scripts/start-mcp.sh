#!/usr/bin/env bash
# MCP server entry point — ensures runtime + deps, then starts the server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

source "$PLUGIN_ROOT/scripts/ensure-runtime.sh" "$PLUGIN_ROOT"

export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
exec bun run "$PLUGIN_ROOT/scripts/start-mcp.ts"
