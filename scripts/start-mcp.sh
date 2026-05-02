#!/usr/bin/env bash
# MCP server entry point — ensures runtime + deps, then starts the server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

source "$PLUGIN_ROOT/scripts/ensure-runtime.sh" "$PLUGIN_ROOT"

# Sanitize plugin-data env vars: Claude Code is supposed to expand
# ${CLAUDE_PLUGIN_DATA} inline (see plugin reference docs), but on at least
# one Linux build the literal "${CLAUDE_PLUGIN_DATA}" leaks through and
# crashes the server. Drop any obviously malformed values so resolveSiaHome
# can fall through to its standalone default.
sanitize_plugin_data() {
	local var_name="$1"
	local value="${!var_name-}"
	# Trim surrounding whitespace.
	value="${value#"${value%%[![:space:]]*}"}"
	value="${value%"${value##*[![:space:]]}"}"
	if [[ -z "$value" ]] \
		|| [[ "$value" == *'${'* ]] \
		|| [[ "$value" != /* ]]; then
		if [[ -n "${!var_name-}" ]]; then
			echo "[sia] warning: $var_name='${!var_name}' looks malformed; ignoring (using default home)" >&2
		fi
		unset "$var_name"
	else
		export "$var_name=$value"
	fi
}
sanitize_plugin_data CLAUDE_PLUGIN_DATA
sanitize_plugin_data SIA_HOME

export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
exec bun run "$PLUGIN_ROOT/scripts/start-mcp.ts"
