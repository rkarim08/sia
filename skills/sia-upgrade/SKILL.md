---
name: sia-upgrade
description: Self-update SIA to the latest version — supports npm, git, and binary upgrade strategies
---

# SIA Upgrade

Update SIA to the latest version.

## Quick Upgrade

Use the `sia_upgrade` MCP tool:

```
sia_upgrade({})
```

Or with options:

```
sia_upgrade({
  target_version: "0.2.0",
  dry_run: true
})
```

Parameters:
- **target_version** (optional): Specific version to upgrade to (default: latest)
- **dry_run** (optional): Preview what would change without applying

## Upgrade Strategies

SIA automatically selects the best upgrade strategy:

1. **npm**: If installed via npm/bun package manager
2. **git**: If running from a cloned repository (pulls latest)
3. **binary**: If a custom release URL is configured

## After Upgrading

1. Run `sia-doctor` to verify the new version is working
2. Database migrations run automatically on next startup
3. Check release notes for any breaking changes
