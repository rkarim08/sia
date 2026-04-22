---
name: sia-workspace
description: Use when working across multiple repos that share an API contract or domain model — manages the cross-repo workspace that lets `sia_search({ workspace: true })` reach across them. Subcommands: `create`, `list`, `add`, `remove`, `show`.
---

# SIA Workspace

Manage workspaces that enable cross-repo knowledge sharing.

## Usage

**When to invoke:**
- You're working across 2+ repos and want shared search
- Setting up a monorepo-style knowledge view from separate repos
- Tracking API contracts between backend and client repos

**Inputs:** Subcommand (`create`, `list`, `add`, `remove`, `show`) plus name and path as positional args.

**Worked example:**

```
$ /sia-workspace create acme-platform
[workspace] Created 'acme-platform' (empty)
$ /sia-workspace add acme-platform /Users/me/src/api
$ /sia-workspace add acme-platform /Users/me/src/web
$ /sia-workspace show acme-platform
acme-platform: 2 repos, 4,812 entities, 12 bridge edges
```

Subsequent `sia_search({ workspace: true })` calls now span both repos.

## What Are Workspaces?

Workspaces group multiple repositories together so SIA can:
- Share knowledge across repos via bridge edges
- Detect API contracts between services
- Enable cross-repo search with `sia_search({ workspace: true })`

## Commands

### Create a workspace

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/workspace.ts create "my-workspace"
```

### List workspaces

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/workspace.ts list
```

### Add a repo to a workspace

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/workspace.ts add "my-workspace" /path/to/repo
```

### Remove a repo from a workspace

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/workspace.ts remove "my-workspace" /path/to/repo
```

### Show workspace details

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/workspace.ts show "my-workspace"
```

## Related: Team Sync

For team-based knowledge sharing (requires a sync server):

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/team.ts join <server-url>
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/team.ts status
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/commands/team.ts leave
```
