#!/usr/bin/env bash
# ---------------------------------------------------------------
# Developer-only script — NOT required for runtime usage.
# WASM grammars are loaded from node_modules/ at runtime.
# This script rebuilds custom grammars from source.
#
# Prerequisites: tree-sitter CLI, emscripten (emcc), jq
#   brew install tree-sitter emscripten jq
# ---------------------------------------------------------------
# build-wasm-grammars.sh
# Builds tree-sitter WASM grammars from npm packages.
# Requires: tree-sitter CLI, emscripten (emcc on PATH)
#
# Usage:
#   ./scripts/build-wasm-grammars.sh [grammar-name ...]
#   If no arguments given, builds all grammars from grammars/versions.json.
#
# Output: grammars/wasm/*.wasm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VERSIONS_FILE="${REPO_ROOT}/grammars/versions.json"
OUT_DIR="${REPO_ROOT}/grammars/wasm"
NODE_MODULES="${REPO_ROOT}/node_modules"

mkdir -p "${OUT_DIR}"

# Check dependencies
if ! command -v tree-sitter &>/dev/null; then
  echo "ERROR: tree-sitter CLI not found. Install with: npm install -g tree-sitter-cli" >&2
  exit 1
fi

if ! command -v emcc &>/dev/null; then
  echo "ERROR: emcc (Emscripten) not found. See https://emscripten.org/docs/getting_started/downloads.html" >&2
  exit 1
fi

# Parse versions.json to get grammar list
# Requires: jq
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq not found. Install with: brew install jq / apt install jq" >&2
  exit 1
fi

# Build a specific grammar given its language key
build_grammar() {
  local lang="$1"
  local pkg wasm_file src_dir

  pkg=$(jq -r ".grammars[\"${lang}\"].package" "${VERSIONS_FILE}")
  wasm_file=$(jq -r ".grammars[\"${lang}\"].wasmFile" "${VERSIONS_FILE}")

  if [[ "${pkg}" == "null" ]]; then
    echo "WARNING: Unknown grammar '${lang}', skipping." >&2
    return 0
  fi

  src_dir="${NODE_MODULES}/${pkg}"

  if [[ ! -d "${src_dir}" ]]; then
    echo "WARNING: Package directory not found: ${src_dir}. Run 'bun install' first." >&2
    return 0
  fi

  echo "Building ${lang} -> ${wasm_file} ..."
  (
    cd "${src_dir}"
    tree-sitter build --wasm --output "${OUT_DIR}/${wasm_file}"
  )
  echo "  Done: ${OUT_DIR}/${wasm_file}"
}

# Determine which grammars to build
if [[ $# -gt 0 ]]; then
  TARGETS=("$@")
else
  mapfile -t TARGETS < <(jq -r '.grammars | keys[]' "${VERSIONS_FILE}")
fi

echo "Building ${#TARGETS[@]} WASM grammar(s) into ${OUT_DIR}/"
for lang in "${TARGETS[@]}"; do
  build_grammar "${lang}"
done

echo ""
echo "All done. WASM files written to: ${OUT_DIR}/"
