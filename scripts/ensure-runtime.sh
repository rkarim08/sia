#!/usr/bin/env bash
# Ensures bun is installed and plugin dependencies are present.
# Called by .mcp.json and all hook scripts before running TypeScript.
# Exits silently on success; prints to stderr on failure.
set -euo pipefail

PLUGIN_ROOT="${1:-.}"

# Audit log: every invocation appends a line so diagnostics have a trail.
SIA_LOG_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.sia}/logs"
mkdir -p "$SIA_LOG_DIR" 2>/dev/null || true
{
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ensure-runtime invoked (plugin_root=$PLUGIN_ROOT pid=$$)"
} >> "$SIA_LOG_DIR/ensure-runtime.log" 2>/dev/null || true

# 1. Check for bun
if ! command -v bun &>/dev/null; then
    # Try common install locations
    if [ -f "$HOME/.bun/bin/bun" ]; then
        export PATH="$HOME/.bun/bin:$PATH"
    else
        # Auto-install bun. Surface a one-line notice so the user
        # knows why the first session feels slow.
        echo "sia: installing bun to \$HOME/.bun/ (one-time, ~20s)" >&2
        echo "[sia] bun not found — installing..." >&2
        curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
        export PATH="$HOME/.bun/bin:$PATH"
        if ! command -v bun &>/dev/null; then
            echo "[sia] ERROR: failed to install bun. Install manually: https://bun.sh" >&2
            exit 1
        fi
        echo "[sia] bun installed successfully" >&2
    fi
fi

# 2. Check for node_modules
if [ ! -d "$PLUGIN_ROOT/node_modules" ]; then
    echo "[sia] installing dependencies..." >&2
    (cd "$PLUGIN_ROOT" && bun install --production 2>/dev/null)
    echo "[sia] dependencies installed" >&2

    # Run postinstall once per fresh install. Stamp file prevents re-runs.
    POSTINSTALL_STAMP="${CLAUDE_PLUGIN_DATA:-$HOME/.sia}/.postinstalled"
    if [ ! -f "$POSTINSTALL_STAMP" ]; then
        mkdir -p "$(dirname "$POSTINSTALL_STAMP")"
        bash "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/postinstall.sh" \
            >> "${CLAUDE_PLUGIN_DATA:-$HOME/.sia}/logs/postinstall.log" 2>&1 || true
        touch "$POSTINSTALL_STAMP"
    fi
fi
