#!/usr/bin/env bash
# Regenerate PLUGIN_USAGE.md tables from the frontmatter `description:` and
# the first non-heading line of the Usage section in each SKILL / agent /
# command. The output is deliberately simpler than the hand-authored file
# (flat tables, no category grouping) so the Phase 6 validator can diff the
# two and detect drift.
#
# Usage:
#   bash scripts/generate-plugin-usage.sh           # print to stdout
#   bash scripts/generate-plugin-usage.sh --verify  # exit non-zero on drift
#
# Note: this generator is intentionally simple for v1.1.7. It is a starting
# point — the Phase 6 validator may tighten the contract (e.g. require every
# skill/agent/command to have a parseable Usage section).
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="print"
if [[ "${1:-}" == "--verify" ]]; then
  MODE="verify"
fi

# Extract the frontmatter `description:` field from a given file. Returns
# the raw value (quotes stripped, trailing whitespace trimmed) or empty.
extract_description() {
  local file="$1"
  awk '
    /^---[[:space:]]*$/ { in_fm = !in_fm; next }
    in_fm && /^description:/ {
      sub(/^description:[[:space:]]*/, "")
      sub(/^"/, ""); sub(/"[[:space:]]*$/, "")
      sub(/^'\''/, ""); sub(/'\''[[:space:]]*$/, "")
      print
      exit
    }
  ' "$file"
}

# Extract the first non-heading line after any "Usage" / "When To Use"
# / "How It Works" section heading. Returns empty if no such section.
extract_usage_hint() {
  local file="$1"
  awk '
    BEGIN { in_usage = 0 }
    /^##[[:space:]]+(Usage|When To Use|When to use|How It Works|How it works)/ { in_usage = 1; next }
    /^##[[:space:]]/ { in_usage = 0 }
    in_usage && NF > 0 && $0 !~ /^[[:space:]]*(#|-|\*|```|\|)/ {
      print
      exit
    }
  ' "$file"
}

print_skills_table() {
  echo "## Skills"
  echo
  echo "| Skill | What it does | When to invoke |"
  echo "|---|---|---|"
  for dir in skills/*/; do
    local name
    name=$(basename "$dir")
    # Strip any trailing slash on $dir before appending SKILL.md so we don't
    # emit //SKILL.md.
    local clean="${dir%/}"
    local skill_file="${clean}/SKILL.md"
    [[ -f "$skill_file" ]] || continue
    local desc
    desc=$(extract_description "$skill_file")
    # Strip the "Use when..." tail for the summary table.
    desc="${desc%%. Use when*}"
    desc="${desc%%. Called automatically*}"
    local hint
    hint=$(extract_usage_hint "$skill_file")
    echo "| [$name]($skill_file) | $desc | $hint |"
  done
}

print_agents_table() {
  echo
  echo "## Agents"
  echo
  echo "| Agent | What it does | When to invoke |"
  echo "|---|---|---|"
  for f in agents/*.md; do
    [[ -f "$f" ]] || continue
    local name
    name=$(basename "$f" .md)
    local desc
    desc=$(extract_description "$f")
    desc="${desc%%. Use when*}"
    desc="${desc%%. Works for*}"
    local hint
    hint=$(extract_usage_hint "$f")
    echo "| [$name]($f) | $desc | $hint |"
  done
}

print_commands_table() {
  echo
  echo "## Commands"
  echo
  echo "| Command | Description | Kind | When to invoke |"
  echo "|---|---|---|---|"
  for f in commands/*.md; do
    [[ -f "$f" ]] || continue
    local name
    name=$(basename "$f" .md)
    local desc
    desc=$(extract_description "$f")
    # Detect kind by grepping for the body pattern.
    local kind="other"
    if grep -qE '^Run the `/sia-' "$f"; then
      kind="skill-shim"
    elif grep -qE '^Dispatch the `@sia-' "$f"; then
      kind="agent-delegation"
    elif grep -qE '^(Invoke|Call) the `(sia|nous)_' "$f"; then
      kind="mcp-wrapper"
    fi
    local hint
    hint=$(extract_usage_hint "$f")
    echo "| /$name | $desc | $kind | $hint |"
  done
}

generate() {
  echo "# Sia Plugin Usage — Generated"
  echo
  echo "_This file is machine-generated from skill / agent / command frontmatter. Do not hand-edit. Regenerate with \`bash scripts/generate-plugin-usage.sh\`._"
  echo
  print_skills_table
  print_agents_table
  print_commands_table
}

if [[ "$MODE" == "verify" ]]; then
  # Drift detection: compare the generated tables against whatever is present
  # in PLUGIN_USAGE.md. Since PLUGIN_USAGE.md is currently hand-authored and
  # has a richer structure than the generator produces, the v1.1.7 verify
  # mode is a coarse check: every skill / agent / non-shim command name must
  # appear somewhere in PLUGIN_USAGE.md. Tighten in Phase 6 once hand-authoring
  # is retired.
  target="PLUGIN_USAGE.md"
  if [[ ! -f "$target" ]]; then
    echo "ERROR: $target not found" >&2
    exit 2
  fi
  missing=0
  for dir in skills/*/; do
    name=$(basename "$dir")
    # Use word-boundary match so e.g. future skill 'sia-at' does not pass
    # verify via a substring match inside 'sia-at-time'.
    if ! grep -Eq "(^|[^A-Za-z0-9_-])${name}([^A-Za-z0-9_-]|$)" "$target"; then
      echo "drift: skill '$name' not listed in $target" >&2
      missing=$((missing + 1))
    fi
  done
  for f in agents/*.md; do
    name=$(basename "$f" .md)
    if ! grep -Eq "(^|[^A-Za-z0-9_-])${name}([^A-Za-z0-9_-]|$)" "$target"; then
      echo "drift: agent '$name' not listed in $target" >&2
      missing=$((missing + 1))
    fi
  done
  if [[ "$missing" -gt 0 ]]; then
    echo "drift detected: $missing component(s) missing from $target" >&2
    exit 1
  fi
  echo "ok: all skills and agents appear in $target"
  exit 0
fi

generate
