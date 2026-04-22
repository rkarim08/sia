# Security Policy

## Supported versions

Latest minor only. Upgrade before reporting.

## Reporting a vulnerability

Open a private advisory at https://github.com/rkarim08/sia/security/advisories/new. Do not file public issues for security reports.

## Threat model

Sia runs local-only by default. The sandbox executor (`sia_execute`, `sia_execute_file`, `sia_batch_execute`) spawns subprocesses under the user's shell. Inputs should be treated as developer-authored code — not untrusted user input. If your project exposes Sia's MCP server to an untrusted network, disable these tools via your MCP client configuration.

## Known surfaces

- SQLite graph at `$SIA_HOME/repos/<hash>/graph.db` — readable by anyone with filesystem access.
- `postinstall.sh` strips `.git` from `$PLUGIN_ROOT` when installed under `/.claude/plugins/`. The strip is gated on path substring matching.
- `ensure-runtime.sh` installs bun to `$HOME/.bun/` on the first hook fire without prompting.
