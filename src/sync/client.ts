// Module: client — LibSQL-backed SiaDb factory for team sync

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { OpenDbOpts, SiaDb } from "@/graph/db-interface";
import { LibSqlDb } from "@/graph/db-interface";
import type { SyncConfig } from "@/shared/config";
import { SIA_HOME } from "@/shared/config";
import { getToken } from "@/sync/keychain";

/**
 * Open a LibSqlDb (embedded replica) when sync is enabled; otherwise fall back
 * to the local BunSqliteDb.
 */
export async function createSiaDb(
	repoHash: string,
	config: SyncConfig,
	opts: OpenDbOpts = {},
): Promise<SiaDb> {
	if (!config.enabled || !config.serverUrl) {
		throw new Error("createSiaDb() called without sync enabled. Use openSiaDb() instead.");
	}

	const token = await getToken(config.serverUrl);
	if (!token) {
		throw new Error("Run 'npx sia team join' to authenticate");
	}

	const home = opts.siaHome ?? SIA_HOME;
	const repoDir = join(home, "repos", repoHash);
	mkdirSync(repoDir, { recursive: true });
	const dbPath = join(repoDir, "graph.db");

	const { createClient } = await import("@libsql/client");
	const client = createClient({
		url: `file:${dbPath}`,
		syncUrl: config.serverUrl,
		authToken: token,
		syncInterval: config.syncInterval,
	});

	return new LibSqlDb(client);
}
