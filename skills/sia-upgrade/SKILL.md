---
name: sia-upgrade
description: Self-updates SIA to the latest version via npm, git, or binary strategies. Use when a new SIA version is available or when the user asks to upgrade.
---

# SIA Upgrade

Update SIA to the latest version.

## Usage

**When to invoke:**
- A new SIA release is announced
- CHANGELOG shows a fix you need
- Regular maintenance (monthly)

**Inputs:** Optional `target_version`; optional `dry_run`. See below.

**Worked example:**

```
sia_upgrade({ dry_run: true })
// → "Would upgrade 1.1.6 → 1.1.7 via npm; no breaking changes in release notes"
sia_upgrade({})
// → "Upgraded to 1.1.7. Run /sia-doctor to verify."
```

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
