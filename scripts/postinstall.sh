#!/usr/bin/env bash
# Rebuild tree-sitter native binding with C++20 (required for Node 23.x headers).
# Falls back to WASM if native build fails — no user action needed.
set -uo pipefail

TS_DIR="node_modules/tree-sitter"

# Skip if tree-sitter wasn't installed (optional dep) or already built
if [ ! -d "$TS_DIR" ] || [ -f "$TS_DIR/build/Release/tree_sitter_runtime_binding.node" ]; then
    exit 0
fi

echo "sia: rebuilding tree-sitter native binding with C++20..."
cd "$TS_DIR"
if CXXFLAGS="-std=c++20" npx node-gyp rebuild 2>/dev/null; then
    echo "sia: native tree-sitter built successfully"
else
    echo "sia: native tree-sitter build failed — WASM fallback will be used"
fi
