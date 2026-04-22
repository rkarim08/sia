#!/usr/bin/env bash
# Sia plugin schema + integrity validator (Phase 6, v1.1.10).
#
# Runs nine checks, fail-fast on the first error. Targets bash 3.2 (macOS
# default) and bash 5 (Linux CI). Uses only jq + POSIX utilities. Should
# complete in under 5 seconds on a laptop.
#
# Checks:
#   1. manifest     — plugin.json / marketplace.json schema + version parity
#   2. counts       — README/PLUGIN_README tool/skill/agent/command counts
#                     match scripts/count-plugin-components.sh output
#   3. registry     — TOOL_NAMES constant matches server.registerTool() calls
#                     in src/mcp/server.ts; handler file map is a soft check
#   4. agents       — every agents/*.md has name/description/tools/model,
#                     tools reference real Claude built-ins or registered
#                     MCP tools; color: is a soft check
#   5. skills       — every skills/*/SKILL.md has name + description;
#                     "Use ..." without "when" warns
#   6. commands     — every commands/*.md has description
#   7. hooks        — every command path in hooks/hooks.json resolves
#                     to an existing, executable file (after substituting
#                     ${CLAUDE_PLUGIN_ROOT})
#   8. portability  — no hardcoded /Users/, /home/, or ~/ paths in
#                     hooks.json, .mcp.json, or scripts/*.sh
#   9. usage        — scripts/generate-plugin-usage.sh --verify passes
#
# Exit 0 on success with one-line OK summary. Exit non-zero with a
# `[validate-plugin] FAIL (<check>): <message>` diagnostic on failure.

set -euo pipefail

# Resolve repo root. Works whether invoked as ./scripts/validate-plugin.sh,
# bash scripts/validate-plugin.sh, or from any cwd.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

PASSED=()

fail() {
	local check="$1"
	shift
	echo "[validate-plugin] FAIL ($check): $*" >&2
	exit 1
}

pass() {
	PASSED+=("$1")
}

# Require jq for JSON parsing.
if ! command -v jq >/dev/null 2>&1; then
	fail "env" "jq not found on PATH — install jq to run the validator"
fi

# ---------------------------------------------------------------------------
# Check 1: manifest schema + version parity
# ---------------------------------------------------------------------------
check_manifest() {
	local plugin_json=".claude-plugin/plugin.json"
	local market_json=".claude-plugin/marketplace.json"

	[[ -f "$plugin_json" ]] || fail "manifest" "$plugin_json missing"
	[[ -f "$market_json" ]] || fail "manifest" "$market_json missing"

	local name version
	name=$(jq -er '.name // empty' "$plugin_json") \
		|| fail "manifest" "plugin.json missing required 'name' field"
	version=$(jq -er '.version // empty' "$plugin_json") \
		|| fail "manifest" "plugin.json missing required 'version' field"

	# kebab-case: [a-z][a-z0-9-]*
	if ! printf '%s' "$name" | grep -Eq '^[a-z][a-z0-9-]*$'; then
		fail "manifest" "plugin.json name is not kebab-case: \"$name\""
	fi

	# semver: ^\d+\.\d+\.\d+$
	if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
		fail "manifest" "plugin.json version field is not semver: \"$version\""
	fi

	local market_top market_plugin0
	market_top=$(jq -er '.version // empty' "$market_json") \
		|| fail "manifest" "marketplace.json missing top-level 'version'"
	market_plugin0=$(jq -er '.plugins[0].version // empty' "$market_json") \
		|| fail "manifest" "marketplace.json plugins[0] missing 'version'"

	if [[ "$market_top" != "$version" ]]; then
		fail "manifest" \
			"marketplace.json top-level version \"$market_top\" != plugin.json \"$version\""
	fi
	if [[ "$market_plugin0" != "$version" ]]; then
		fail "manifest" \
			"marketplace.json plugins[0].version \"$market_plugin0\" != plugin.json \"$version\""
	fi

	# metadata.version is advisory but if present must also match.
	local market_meta
	market_meta=$(jq -r '.metadata.version // empty' "$market_json")
	if [[ -n "$market_meta" && "$market_meta" != "$version" ]]; then
		fail "manifest" \
			"marketplace.json metadata.version \"$market_meta\" != plugin.json \"$version\""
	fi

	pass "manifest"
}

# ---------------------------------------------------------------------------
# Check 2: documented counts match count-plugin-components.sh
# ---------------------------------------------------------------------------
check_counts() {
	local counts
	counts=$(bash scripts/count-plugin-components.sh) \
		|| fail "counts" "scripts/count-plugin-components.sh failed"

	local skills agents commands mcp_tools
	skills=$(printf '%s\n' "$counts" | awk '/^Skills:/ {print $2}')
	agents=$(printf '%s\n' "$counts" | awk '/^Agents:/ {print $2}')
	commands=$(printf '%s\n' "$counts" | awk '/^Commands:/ {print $2}')
	mcp_tools=$(printf '%s\n' "$counts" | awk '/^MCP tools:/ {print $3}')

	[[ -n "$skills" && -n "$agents" && -n "$commands" && -n "$mcp_tools" ]] \
		|| fail "counts" "could not parse count-plugin-components.sh output"

	# Extract numeric claims from README and PLUGIN_README.
	#
	# We look for the three canonical claim shapes the repo has used:
	#   "<N> MCP tools"            e.g. "29 MCP tools"
	#   "<N> tools via the Model"  e.g. "29 tools via the Model Context Protocol"
	#   "<N> skills"
	#   "<N> agents"
	#   "<N> hook entries"
	#
	# Any match that disagrees with the authoritative count fails.
	check_doc_counts() {
		local doc="$1"
		[[ -f "$doc" ]] || return 0

		# MCP tools
		local line
		while IFS= read -r line; do
			local n
			n=$(printf '%s' "$line" | grep -oE '[0-9]+ (MCP )?tools( via the Model Context Protocol)?' \
				| head -1 | grep -oE '^[0-9]+')
			if [[ -n "$n" && "$n" != "$mcp_tools" ]]; then
				fail "counts" \
					"$doc claims \"$n tools\" but registry has $mcp_tools"
			fi
		done < <(grep -nE '[0-9]+ (MCP )?tools( via the Model Context Protocol)?' "$doc" || true)

		# Skills
		while IFS= read -r line; do
			local n
			n=$(printf '%s' "$line" | grep -oE '[0-9]+ skills' \
				| head -1 | grep -oE '^[0-9]+')
			if [[ -n "$n" && "$n" != "$skills" ]]; then
				fail "counts" \
					"$doc claims \"$n skills\" but filesystem has $skills"
			fi
		done < <(grep -nE '[0-9]+ skills' "$doc" || true)

		# Agents
		while IFS= read -r line; do
			local n
			n=$(printf '%s' "$line" | grep -oE '[0-9]+ agents' \
				| head -1 | grep -oE '^[0-9]+')
			if [[ -n "$n" && "$n" != "$agents" ]]; then
				fail "counts" \
					"$doc claims \"$n agents\" but filesystem has $agents"
			fi
		done < <(grep -nE '[0-9]+ agents' "$doc" || true)

		# Hook entries
		while IFS= read -r line; do
			local n
			n=$(printf '%s' "$line" | grep -oE '[0-9]+ hook entries' \
				| head -1 | grep -oE '^[0-9]+')
			local hooks
			hooks=$(printf '%s\n' "$counts" | awk '/^Hook entries:/ {print $3}')
			if [[ -n "$n" && -n "$hooks" && "$n" != "$hooks" ]]; then
				fail "counts" \
					"$doc claims \"$n hook entries\" but hooks.json has $hooks"
			fi
		done < <(grep -nE '[0-9]+ hook entries' "$doc" || true)
	}

	check_doc_counts README.md
	check_doc_counts PLUGIN_README.md

	pass "counts"
}

# ---------------------------------------------------------------------------
# Check 3: MCP tool registry consistency
# ---------------------------------------------------------------------------
check_registry() {
	local server="src/mcp/server.ts"
	[[ -f "$server" ]] || fail "registry" "$server missing"

	# Extract from the TOOL_NAMES array. We anchor to the `export const
	# TOOL_NAMES = [` line and read until the terminator `]`. A simple
	# grep for "sia_..."/"nous_..." inside that block is sufficient.
	local in_block=0
	local declared_names
	declared_names=$(awk '
		/^export const TOOL_NAMES = \[/ { in_block = 1; next }
		in_block && /^\]/ { in_block = 0 }
		in_block && /"(sia_|nous_)[a-z_]+"/ {
			match($0, /"(sia_|nous_)[a-z_]+"/)
			print substr($0, RSTART + 1, RLENGTH - 2)
		}
	' "$server" | sort -u)

	[[ -n "$declared_names" ]] \
		|| fail "registry" "TOOL_NAMES constant not found or empty in $server"

	# Extract names passed to server.registerTool("...", ...). These may
	# span lines so we grep the first string arg after the call.
	local registered_names
	registered_names=$(grep -nE 'server\.registerTool\(' "$server" -A1 \
		| grep -oE '"(sia_|nous_)[a-z_]+"' \
		| sed 's/"//g' \
		| sort -u)

	# Every name in TOOL_NAMES must have a registerTool call.
	local missing=""
	local name
	while IFS= read -r name; do
		[[ -z "$name" ]] && continue
		if ! printf '%s\n' "$registered_names" | grep -qx "$name"; then
			missing="${missing}${missing:+, }$name"
		fi
	done <<EOF
$declared_names
EOF
	if [[ -n "$missing" ]]; then
		fail "registry" "TOOL_NAMES contains unregistered tools: $missing"
	fi

	# And every registered tool must be in TOOL_NAMES.
	local orphan=""
	while IFS= read -r name; do
		[[ -z "$name" ]] && continue
		if ! printf '%s\n' "$declared_names" | grep -qx "$name"; then
			orphan="${orphan}${orphan:+, }$name"
		fi
	done <<EOF
$registered_names
EOF
	if [[ -n "$orphan" ]]; then
		fail "registry" "registerTool() calls reference names not in TOOL_NAMES: $orphan"
	fi

	# Soft check — map handler files under src/mcp/tools/*.ts to tool names.
	# Handler filenames convert sia_at_time -> sia-at-time.ts. Report
	# mismatches as a note on stderr but do not fail; snapshot_* tools
	# are handled inline in server.ts.
	if [[ -d "src/mcp/tools" ]]; then
		local handler
		for handler in src/mcp/tools/*.ts; do
			[[ -f "$handler" ]] || continue
			local base expected
			base="$(basename "$handler" .ts)"
			expected="$(printf '%s' "$base" | tr '-' '_')"
			if ! printf '%s\n' "$declared_names" | grep -qx "$expected"; then
				echo "[validate-plugin] note (registry): handler $handler has no matching TOOL_NAMES entry '$expected'" >&2
			fi
		done
	fi

	pass "registry"
}

# ---------------------------------------------------------------------------
# Check 4: agent frontmatter + tool references
# ---------------------------------------------------------------------------
check_agents() {
	local server="src/mcp/server.ts"
	local registered_names
	registered_names=$(grep -nE 'server\.registerTool\(' "$server" -A1 2>/dev/null \
		| grep -oE '"(sia_|nous_)[a-z_]+"' \
		| sed 's/"//g' \
		| sort -u)

	# Claude Code built-in tools. List maintained from Claude Code docs;
	# update when new tools ship. ExitPlanMode and BashOutput are recent
	# additions — keep this liberal rather than strict.
	local builtins="Agent AskUserQuestion Bash BashOutput Edit ExitPlanMode Glob Grep KillBash Mcp MultiEdit NotebookEdit Read SlashCommand Task TodoWrite WebFetch WebSearch Write"

	local f
	for f in agents/*.md; do
		[[ -f "$f" ]] || continue
		local fname
		fname="$(basename "$f")"
		# README.md documents the directory, not an agent.
		[[ "$fname" == "README.md" ]] && continue

		# Extract the frontmatter block between the first two `---` lines.
		local fm
		fm=$(awk '
			/^---[[:space:]]*$/ { c++; if (c == 2) exit; next }
			c == 1 { print }
		' "$f")

		local field
		for field in name description tools model; do
			if ! printf '%s\n' "$fm" | grep -Eq "^${field}:"; then
				fail "agents" "$fname missing frontmatter field '${field}:'"
			fi
		done

		# Soft: color
		if ! printf '%s\n' "$fm" | grep -Eq '^color:'; then
			echo "[validate-plugin] warn (agents): $fname missing 'color:' frontmatter" >&2
		fi

		# Parse tools: line. Supports single-line comma-separated form:
		#   tools: Read, Grep, mcp__sia__sia_search
		# (block / YAML-list form is not used in this repo; add when it is).
		local tools_line
		tools_line=$(printf '%s\n' "$fm" | awk '/^tools:/ { sub(/^tools:[[:space:]]*/, ""); print; exit }')
		if [[ -z "$tools_line" ]]; then
			fail "agents" "$fname has empty 'tools:' list"
		fi

		# Split and validate each tool.
		local tool
		# shellcheck disable=SC2086
		local IFS_SAVE="$IFS"
		IFS=','
		set -f
		for tool in $tools_line; do
			set +f
			IFS="$IFS_SAVE"
			# Trim whitespace.
			tool="${tool#"${tool%%[![:space:]]*}"}"
			tool="${tool%"${tool##*[![:space:]]}"}"
			[[ -z "$tool" ]] && { IFS=','; set -f; continue; }

			# MCP tool reference: mcp__<server>__<tool_name>
			if [[ "$tool" == mcp__* ]]; then
				# Strip the mcp__<server>__ prefix. For this repo the
				# server name is `sia` so the canonical shape is
				# mcp__sia__<tool_name>.
				local suffix="${tool#mcp__}"
				suffix="${suffix#*__}"
				if ! printf '%s\n' "$registered_names" | grep -qx "$suffix"; then
					fail "agents" \
						"$fname references unknown MCP tool '$tool' (not in TOOL_NAMES)"
				fi
			else
				# Built-in Claude Code tool.
				local found=0
				local b
				for b in $builtins; do
					if [[ "$tool" == "$b" ]]; then
						found=1
						break
					fi
				done
				if [[ "$found" -eq 0 ]]; then
					fail "agents" \
						"$fname references unknown tool '$tool' (not a built-in or registered MCP tool)"
				fi
			fi
			IFS=','
			set -f
		done
		set +f
		IFS="$IFS_SAVE"
	done

	pass "agents"
}

# ---------------------------------------------------------------------------
# Check 5: skill frontmatter
# ---------------------------------------------------------------------------
check_skills() {
	local d
	for d in skills/*/; do
		local clean="${d%/}"
		local skill_file="${clean}/SKILL.md"
		[[ -f "$skill_file" ]] || fail "skills" "$clean missing SKILL.md"

		local fm
		fm=$(awk '
			/^---[[:space:]]*$/ { c++; if (c == 2) exit; next }
			c == 1 { print }
		' "$skill_file")

		local field
		for field in name description; do
			if ! printf '%s\n' "$fm" | grep -Eq "^${field}:"; then
				fail "skills" "$skill_file missing frontmatter field '${field}:'"
			fi
		done

		# Style warning: description starts with "Use " but not "Use when".
		local desc
		desc=$(printf '%s\n' "$fm" | awk '/^description:/ { sub(/^description:[[:space:]]*/, ""); print; exit }')
		# Strip leading quote.
		desc="${desc#\"}"
		desc="${desc#\'}"
		if [[ "$desc" == Use\ * && "$desc" != Use\ when* ]]; then
			echo "[validate-plugin] warn (skills): $skill_file description starts with 'Use ' but not 'Use when' — '$desc'" >&2
		fi
	done

	pass "skills"
}

# ---------------------------------------------------------------------------
# Check 6: command frontmatter
# ---------------------------------------------------------------------------
check_commands() {
	local f
	for f in commands/*.md; do
		[[ -f "$f" ]] || continue
		# README.md documents the directory, not a command.
		[[ "$(basename "$f")" == "README.md" ]] && continue
		local fm
		fm=$(awk '
			/^---[[:space:]]*$/ { c++; if (c == 2) exit; next }
			c == 1 { print }
		' "$f")
		if ! printf '%s\n' "$fm" | grep -Eq '^description:'; then
			fail "commands" "$(basename "$f") missing frontmatter field 'description:'"
		fi
	done
	pass "commands"
}

# ---------------------------------------------------------------------------
# Check 7: hook handler existence
# ---------------------------------------------------------------------------
check_hooks() {
	local hooks_json="hooks/hooks.json"
	[[ -f "$hooks_json" ]] || fail "hooks" "$hooks_json missing"

	# Pull every command string.
	local cmds
	cmds=$(jq -r '[.hooks | to_entries[] | .value[] | .hooks[] | .command] | .[]' "$hooks_json") \
		|| fail "hooks" "could not parse $hooks_json"

	local cmd
	while IFS= read -r cmd; do
		[[ -z "$cmd" ]] && continue

		# Substitute ${CLAUDE_PLUGIN_ROOT} with $ROOT.
		local expanded="${cmd//\$\{CLAUDE_PLUGIN_ROOT\}/$ROOT}"

		# The command may be of the form "bun <path>" or just "<path>".
		# We locate the first token that resolves to an existing file.
		#
		# Simplest: split on whitespace, iterate tokens, and require the
		# first token that contains a "/" to resolve.
		local token script_path=""
		for token in $expanded; do
			if [[ "$token" == */* ]]; then
				script_path="$token"
				break
			fi
		done

		[[ -n "$script_path" ]] \
			|| fail "hooks" "hooks.json command '$cmd' has no script path"

		if [[ ! -f "$script_path" ]]; then
			# Keep the error message in repo-relative form.
			local rel="${script_path#$ROOT/}"
			fail "hooks" "hooks.json refers to $rel which does not exist"
		fi

		# .sh scripts must be executable. .ts handlers run via `bun` so
		# they need not be executable.
		if [[ "$script_path" == *.sh && ! -x "$script_path" ]]; then
			local rel="${script_path#$ROOT/}"
			fail "hooks" "hooks.json refers to $rel which is not executable"
		fi
	done <<EOF
$cmds
EOF

	pass "hooks"
}

# ---------------------------------------------------------------------------
# Check 8: portability — no hardcoded absolute paths
# ---------------------------------------------------------------------------
check_portability() {
	# Files scoped by spec: hooks.json, .mcp.json, scripts/*.sh.
	#
	# Forbidden patterns: /Users/, /home/, ~/ (user-relative).
	# Comments that contain ~/.claude/... are also caught, which is
	# intentional — comments that embed absolute paths still hurt
	# portability in generated docs.
	local pattern='(/Users/|/home/|~/)'
	local files=(hooks/hooks.json .mcp.json)
	local f
	for f in scripts/*.sh; do
		# Skip the validator itself — it mentions the forbidden
		# patterns in its own documentation + grep regex. Scanning
		# it produces a spurious self-match.
		[[ "$(basename "$f")" == "validate-plugin.sh" ]] && continue
		files+=("$f")
	done

	local hit
	for f in "${files[@]}"; do
		[[ -f "$f" ]] || continue
		if hit=$(grep -nE "$pattern" "$f"); then
			fail "portability" "$f contains hardcoded absolute path: $hit"
		fi
	done

	pass "portability"
}

# ---------------------------------------------------------------------------
# Check 9: PLUGIN_USAGE drift (delegates to generate-plugin-usage.sh)
# ---------------------------------------------------------------------------
check_usage() {
	if ! bash scripts/generate-plugin-usage.sh --verify >/tmp/validate-plugin-usage.$$ 2>&1; then
		local out
		out=$(cat /tmp/validate-plugin-usage.$$)
		rm -f /tmp/validate-plugin-usage.$$
		fail "usage" "scripts/generate-plugin-usage.sh --verify failed — run it and fix PLUGIN_USAGE.md drift:
$out"
	fi
	rm -f /tmp/validate-plugin-usage.$$
	pass "usage"
}

# ---------------------------------------------------------------------------
# Run all checks (fail-fast).
# ---------------------------------------------------------------------------
check_manifest
check_counts
check_registry
check_agents
check_skills
check_commands
check_hooks
check_portability
check_usage

echo "[validate-plugin] OK: ${#PASSED[@]} checks passed ($(printf '%s, ' "${PASSED[@]}" | sed 's/, $//'))"
