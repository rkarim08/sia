---
name: sia-workspace
description: Manages SIA workspaces for cross-repo knowledge sharing — creating workspaces, adding repos, and detecting API contracts. Use when working across multiple repositories or setting up shared knowledge.
---

# SIA Workspace

Manage workspaces that enable cross-repo knowledge sharing.

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
