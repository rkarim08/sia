#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { resolveRepoHash } from "../src/capture/hook";
import { openBridgeDb } from "../src/graph/bridge-db";
import { openMetaDb } from "../src/graph/meta-db";
import { openGraphDb } from "../src/graph/semantic-db";
import { startServer } from "../src/mcp/server";
import { getConfig, resolveSiaHome } from "../src/shared/config";

// Wrap critical init in try-catch so MCP server failures are visible in stderr
try {
	const cwd = process.env.CLAUDE_CWD || process.cwd();
	const repoHash = resolveRepoHash(cwd);
	const siaHome = resolveSiaHome();
	const config = getConfig(siaHome);

	const graphDb = openGraphDb(repoHash, siaHome);
	const metaDb = openMetaDb(siaHome);
	const bridgeDb = openBridgeDb(siaHome);
	const sessionId = randomUUID();

	await startServer({ graphDb, bridgeDb, metaDb, embedder: null, config, sessionId });
	process.stderr.write("sia: MCP server started\n");

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
} catch (err) {
	const msg = err instanceof Error ? err.message : String(err);
	const stack = err instanceof Error ? err.stack : "";
	process.stderr.write(`sia: MCP server failed to start: ${msg}\n`);
	if (stack) process.stderr.write(`sia: ${stack}\n`);
	process.exit(1);
}
