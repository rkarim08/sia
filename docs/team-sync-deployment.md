# SIA Team Sync — Server Deployment Guide

This guide is for DevOps teams deploying a sqld (libSQL) sync server for SIA team knowledge sharing.

## Overview

SIA uses libSQL embedded replicas for team sync. Each developer's machine has a local SQLite database that syncs to a central sqld server. The server acts as a relay — it stores the canonical copy and replicates to all connected developers.

## Deployment Options

### Option 1: Docker (Quickest)

```bash
# On the sync server machine:
sia server start --port 8080
```

This writes a `docker-compose.yml` to `~/.sia/server/` and runs `docker compose up -d`. The sqld container listens on port 8080.

Alternatively, run the container directly:

```bash
docker run -d \
  --name sia-sync \
  -p 8080:8080 \
  -v sia-data:/var/lib/sqld \
  -e SQLD_AUTH_JWT_KEY=<your-jwt-secret> \
  ghcr.io/tursodatabase/libsql-server:latest
```

### Option 2: Direct Binary

Download `sqld` from https://github.com/tursodatabase/libsql and run directly:

```bash
sqld --http-listen-addr 0.0.0.0:8080 \
     --auth-jwt-key <your-jwt-secret> \
     --db-path /var/lib/sqld/sia.db
```

### Option 3: Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sia-sync
spec:
  replicas: 1  # Single writer — do not scale replicas
  selector:
    matchLabels:
      app: sia-sync
  template:
    metadata:
      labels:
        app: sia-sync
    spec:
      containers:
      - name: sqld
        image: ghcr.io/tursodatabase/libsql-server:latest
        ports:
        - containerPort: 8080
        env:
        - name: SQLD_AUTH_JWT_KEY
          valueFrom:
            secretKeyRef:
              name: sia-sync-secrets
              key: jwt-key
        volumeMounts:
        - name: data
          mountPath: /var/lib/sqld
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: sia-sync-data
---
apiVersion: v1
kind: Service
metadata:
  name: sia-sync
spec:
  selector:
    app: sia-sync
  ports:
  - port: 8080
    targetPort: 8080
```

## Token Generation

Generate JWT tokens for developers:

```bash
# Generate a shared secret (store securely)
openssl rand -hex 32 > jwt-secret.txt

# Start sqld with this secret
sqld --auth-jwt-key $(cat jwt-secret.txt) ...

# Generate a token for a developer (using any JWT library)
# The token needs no specific claims — sqld validates the signature only
```

For simple setups, use a shared token for the whole team. For per-developer tokens, use a JWT library to generate unique tokens signed with the same secret.

## Network Requirements

- **Port:** 8080 (configurable)
- **Protocol:** HTTP (supports TLS via reverse proxy)
- **Bandwidth:** Minimal — only changed entities sync (~1-10 KB per session)
- **Latency:** Not critical — sync is session-boundary, not real-time

## TLS (Recommended for Production)

Place a reverse proxy (nginx, Caddy, Traefik) in front of sqld:

```
Developer → HTTPS → Reverse Proxy → HTTP → sqld:8080
```

Developers join with the HTTPS URL: `sia team join https://sia-sync.yourcompany.com <token>`

## Monitoring

- **Health check:** `curl http://localhost:8080/health`
- **Database size:** Check `/var/lib/sqld/sia.db` file size
- **Connections:** sqld logs connection events to stdout

## Backup

The server stores a single SQLite database. Backup options:
- File-level backup of `/var/lib/sqld/sia.db`
- SQLite `.backup` command
- Volume snapshots (Docker/k8s)

## Data Retention

The database grows as developers capture knowledge. To manage size:
- SIA's decay system archives low-importance entities
- The `sia prune` command removes archived entities
- Periodic database VACUUM reclaims space
