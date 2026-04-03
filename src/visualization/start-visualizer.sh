#!/usr/bin/env bash
# Start the custom React visualizer frontend + API server.
# Usage: start-visualizer.sh [--port <vite-port>] [--api-port <api-port>]
#
# Starts:
#   1. bun API server on --api-port (default 52742)
#   2. Vite dev server on --port (default 5173)
#
# The Vite dev server proxies /api/* to the API server.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

VITE_PORT=5173
API_PORT=52742

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) VITE_PORT="$2"; shift 2 ;;
    --api-port) API_PORT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Pre-flight: check if SIA has indexed the project
cd "$PROJECT_ROOT"
NODE_COUNT=$(bun -e "
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const root = resolve('.');
const hash = createHash('sha256').update(root).digest('hex');
const dbDir = process.env.HOME + '/.sia/ast-cache/' + hash;

if (!existsSync(dbDir)) { console.log('0'); process.exit(0); }

try {
  const { openGraphDb } = await import('./src/graph/semantic-db');
  const db = openGraphDb(hash);
  const { rows } = await db.execute('SELECT COUNT(*) as cnt FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL');
  console.log(rows[0]?.cnt ?? 0);
} catch { console.log('0'); }
" 2>/dev/null || echo "0")

if [ "$NODE_COUNT" = "0" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  SIA knowledge graph is empty.                             ║"
  echo "║                                                            ║"
  echo "║  Please run one of the following first:                    ║"
  echo "║    /sia-learn     — full knowledge graph build             ║"
  echo "║    /sia-reindex   — index code entities only               ║"
  echo "║                                                            ║"
  echo "║  Then run /sia-visualize-live again.                       ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  exit 1
fi

echo "Found $NODE_COUNT entities in the knowledge graph."

# Kill existing servers on these ports
lsof -ti :"$API_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti :"$VITE_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

# Start API server
cd "$PROJECT_ROOT"
bun -e "
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { openGraphDb } from './src/graph/semantic-db';
import { createVizApiServer } from './src/visualization/viz-api-server';

const root = resolve('.');
const hash = createHash('sha256').update(root).digest('hex');
const db = openGraphDb(hash);
const server = await createVizApiServer(db, root, ${API_PORT});
console.log(JSON.stringify({type:'api-started', port: server.port}));
setInterval(() => {}, 60000);
" &
API_PID=$!

# Wait for API server
for i in {1..30}; do
  if curl -s "http://localhost:${API_PORT}/api/graph" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

# Start Vite dev server
cd "$FRONTEND_DIR"
npx vite --port "$VITE_PORT" &
VITE_PID=$!

# Wait for Vite
for i in {1..30}; do
  if curl -s "http://localhost:${VITE_PORT}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

echo ""
echo "{\"type\":\"server-started\",\"port\":${VITE_PORT},\"api_port\":${API_PORT},\"url\":\"http://localhost:${VITE_PORT}\",\"api_pid\":${API_PID},\"vite_pid\":${VITE_PID}}"

# Keep alive — wait for either to exit
trap "kill $API_PID $VITE_PID 2>/dev/null" EXIT
wait
