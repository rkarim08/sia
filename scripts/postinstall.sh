#!/usr/bin/env bash
# Post-install steps for Sia plugin.
# 1. Strip .git from installed plugin copies (prevents VS Code Source Control clutter)
# 2. Rebuild tree-sitter native binding with C++20
set -uo pipefail

# When installed as a Claude Code plugin, remove .git so VS Code
# doesn't show the plugin as a separate repo in Source Control.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ "$PLUGIN_ROOT" == *"/.claude/plugins/"* ]] && [ -d "$PLUGIN_ROOT/.git" ]; then
    rm -rf "$PLUGIN_ROOT/.git"
fi

TS_DIR="node_modules/tree-sitter"

# Skip if tree-sitter wasn't installed (optional dep) or already built
if [ ! -d "$TS_DIR" ] || [ -f "$TS_DIR/build/Release/tree_sitter_runtime_binding.node" ]; then
    exit 0
fi

echo "sia: rebuilding tree-sitter native binding with C++20..."
cd "$TS_DIR"
if CXXFLAGS="-std=c++20" npx node-gyp rebuild; then
    echo "sia: native tree-sitter built successfully"
else
    echo "sia: native tree-sitter build failed — WASM fallback will be used"
fi
