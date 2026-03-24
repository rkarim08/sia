---
name: sia-team
description: Manages SIA team sync — joining servers, checking status, or leaving teams. Use when setting up team knowledge sharing, checking sync health, or managing team membership.
---

# SIA Team Sync Management

Manage team-based knowledge graph synchronization. SIA syncs knowledge between team members via a self-hosted sqld (libSQL) server managed by your DevOps team.

## Prerequisites

Your DevOps team must have deployed a sqld sync server. You need:
1. The server URL (e.g., `http://sync.internal:8080` or `https://sia-sync.yourcompany.com`)
2. An auth token (JWT, provided by DevOps)

## Join a Team

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts team join <server-url> <auth-token>
```

This will:
1. Store the auth token securely in the OS keychain
2. Configure sync with the provided server URL
3. Generate a unique developer ID for this machine

After joining, run `/sia-sync` to pull existing team knowledge, then sync is **automatic**:
- **Session start:** Pulls latest team knowledge
- **Session end:** Pushes your captured knowledge

## Check Status

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts team status
```

Or use the `sia_sync_status` MCP tool for programmatic access.

## Leave a Team

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts team leave
```

Disables sync and removes the auth token. Local knowledge is preserved.

## How Sync Works

| Event | What Happens |
|---|---|
| Session start | Auto-pulls latest team knowledge via libSQL replication |
| Session end | Auto-pushes locally captured knowledge |
| `/sia-sync` | Manual push/pull on demand |

- **Ordering:** Hybrid Logical Clock (HLC) ensures causal consistency
- **Dedup:** 3-layer deduplication (name Jaccard, embedding cosine, optional LLM)
- **Conflicts:** Detected via embedding similarity, flagged for resolution
- **Privacy:** Only non-private entities are synced

## Troubleshooting

- **"Token not found":** Re-run join with your auth token
- **"Server unreachable":** Check network connectivity to the sync server URL
- **"Sync not configured":** Run join first
