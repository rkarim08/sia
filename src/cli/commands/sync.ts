// Module: sync — CLI command for manual team sync push/pull
//
// Usage:
//   sia sync         — push then pull
//   sia sync push    — push local knowledge to server
//   sia sync pull    — pull team knowledge from server

import { resolveRepoHash } from "@/capture/hook";
import { getConfig, resolveSiaHome } from "@/shared/config";

function printUsage(): void {
	console.log(`Usage: sia sync [push|pull]

  sia sync         Push then pull (default)
  sia sync push    Push local knowledge to team server
  sia sync pull    Pull team knowledge from server
`);
}

export async function runSync(args: string[]): Promise<void> {
	const subcommand = args[0] ?? "both";

	if (subcommand === "--help" || subcommand === "-h") {
		printUsage();
		return;
	}

	const siaHome = resolveSiaHome();
	const config = getConfig(siaHome);

	if (!config.sync.enabled || !config.sync.serverUrl) {
		console.error("Sync not configured. Run 'sia team join <url> <token>' first.");
		process.exit(1);
	}

	const cwd = process.cwd();
	const repoHash = resolveRepoHash(cwd);

	const { createSiaDb } = await import("@/sync/client");
	const { openBridgeDb } = await import("@/graph/bridge-db");
	const { openMetaDb } = await import("@/graph/meta-db");

	const syncDb = await createSiaDb(repoHash, config.sync, { siaHome });
	const bridgeDb = openBridgeDb(siaHome);
	const metaDb = openMetaDb(siaHome);

	try {
		if (subcommand === "push" || subcommand === "both") {
			const { pushChanges } = await import("@/sync/push");
			const result = await pushChanges(syncDb, config.sync, bridgeDb, repoHash, siaHome);
			process.stdout.write(
				`Push: ${result.entitiesPushed} entities, ${result.edgesPushed} edges, ${result.bridgeEdgesPushed} bridge edges\n`,
			);
		}

		if (subcommand === "pull" || subcommand === "both") {
			const { pullChanges } = await import("@/sync/pull");
			const result = await pullChanges(syncDb, bridgeDb, config.sync, repoHash, siaHome, metaDb);
			process.stdout.write(
				`Pull: ${result.entitiesReceived} entities, ${result.edgesReceived} edges, ${result.vssRefreshed} VSS refreshed\n`,
			);
		}

		if (subcommand !== "push" && subcommand !== "pull" && subcommand !== "both") {
			console.error(`Unknown subcommand: ${subcommand}`);
			printUsage();
			process.exit(1);
		}
	} finally {
		await syncDb.close();
		await bridgeDb.close();
		await metaDb.close();
	}
}
