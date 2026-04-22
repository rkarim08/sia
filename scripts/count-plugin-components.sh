#!/usr/bin/env bash
# Prints authoritative component counts. Used by validate-plugin.sh (Phase 5)
# to detect documentation drift.
set -euo pipefail
cd "$(dirname "$0")/.."

skills=$( { ls -d skills/*/ 2>/dev/null || true; } | wc -l | tr -d ' ')
# Exclude README.md — it documents the directory, it is not itself an agent / command.
agents=$( { ls agents/*.md 2>/dev/null | grep -v '/README\.md$' || true; } | wc -l | tr -d ' ')
commands=$( { ls commands/*.md 2>/dev/null | grep -v '/README\.md$' || true; } | wc -l | tr -d ' ')
mcp_tools=$( { grep -oE '"(sia_|nous_)[a-z_]+"' src/mcp/server.ts 2>/dev/null || true; } | sort -u | wc -l | tr -d ' ')
hook_entries=$(jq '[.hooks | to_entries[] | .value[]] | length' hooks/hooks.json 2>/dev/null || echo 0)
hook_events=$(jq '.hooks | keys | length' hooks/hooks.json 2>/dev/null || echo 0)

echo "Skills:       ${skills}"
echo "Agents:       ${agents}"
echo "Commands:     ${commands}"
echo "MCP tools:    ${mcp_tools}"
echo "Hook entries: ${hook_entries}"
echo "Hook events:  ${hook_events}"
