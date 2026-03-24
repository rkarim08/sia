#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { resolveRepoHash } from "../src/capture/hook";
import { openBridgeDb } from "../src/graph/bridge-db";
import { openMetaDb } from "../src/graph/meta-db";
import { openGraphDb } from "../src/graph/semantic-db";
import { startServer } from "../src/mcp/server";
import { getConfig, resolveSiaHome } from "../src/shared/config";

const cwd = process.cwd();
const repoHash = resolveRepoHash(cwd);
const siaHome = resolveSiaHome();
const config = getConfig(siaHome);

const graphDb = openGraphDb(repoHash, siaHome);
const metaDb = openMetaDb(siaHome);
const bridgeDb = openBridgeDb(siaHome);
const sessionId = randomUUID();

await startServer({ graphDb, bridgeDb, metaDb, embedder: null, config, sessionId });
