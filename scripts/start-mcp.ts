#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { resolveRepoHash } from "../src/capture/hook";
import { openBridgeDb } from "../src/graph/bridge-db";
import { openMetaDb } from "../src/graph/meta-db";
import { openGraphDb } from "../src/graph/semantic-db";
import { startServer } from "../src/mcp/server";
import { getConfig, resolveSiaHome } from "../src/shared/config";

// When launched as a plugin MCP server, process.cwd() may be the plugin cache dir.
// The CLAUDE_CWD env var (if set by the host) provides the real project directory.
const cwd = process.env.CLAUDE_CWD || process.cwd();
const repoHash = resolveRepoHash(cwd);
const siaHome = resolveSiaHome();
const config = getConfig(siaHome);

const graphDb = openGraphDb(repoHash, siaHome);
const metaDb = openMetaDb(siaHome);
const bridgeDb = openBridgeDb(siaHome);
const sessionId = randomUUID();

await startServer({ graphDb, bridgeDb, metaDb, embedder: null, config, sessionId });

// Start maintenance scheduler (background — non-blocking)
try {
	const { openEpisodicDb } = await import("../src/graph/semantic-db");
	const { createMaintenanceScheduler } = await import("../src/decay/maintenance-scheduler");

	const episodicDb = openEpisodicDb(repoHash, siaHome);

	const scheduler = createMaintenanceScheduler({
		graphDb,
		episodicDb,
		bridgeDb,
		config,
		repoHash,
		siaHome,
	});

	scheduler.onStartup(repoHash).catch((err) => {
		process.stderr.write(`sia: maintenance startup failed (non-fatal): ${err}\n`);
	});

	process.stderr.write("sia: maintenance scheduler started\n");
} catch (err) {
	process.stderr.write(`sia: maintenance scheduler init failed: ${err}\n`);
}
