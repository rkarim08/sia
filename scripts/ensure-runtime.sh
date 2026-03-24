#!/usr/bin/env bash
# Ensures bun is installed and plugin dependencies are present.
# Called by .mcp.json and all hook scripts before running TypeScript.
# Exits silently on success; prints to stderr on failure.
set -euo pipefail

PLUGIN_ROOT="${1:-.}"

# 1. Check for bun
if ! command -v bun &>/dev/null; then
    # Try common install locations
    if [ -f "$HOME/.bun/bin/bun" ]; then
        export PATH="$HOME/.bun/bin:$PATH"
    else
        # Auto-install bun
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
fi
