#!/usr/bin/env bun

import { runCommunityCommand } from "@/cli/commands/community";

const VERSION = "1.0.0";

function printHelp(): void {
	console.log(`sia v${VERSION} — Persistent graph memory for AI coding agents

Usage:
  sia <command> [options]

Commands:
  install              Install Sia in the current project
  workspace            Manage workspaces (create, list, add, remove, show)
  team                 Team sync (join, leave, status)
  sync                 Manual push/pull (sync push, sync pull)
  search               Search the knowledge graph
  stats                Show graph statistics
  status               Show knowledge graph health dashboard
  reindex              Re-index the repository
  learn                Build the complete knowledge graph (code + docs + communities)
  community            Show community structure
  doctor               Run diagnostic checks
  digest               Generate session digest
  graph                Visualize the knowledge graph
  visualize-live       Launch interactive browser graph visualizer
  prune                Remove archived entities
  export               Export graph to JSON
  export-knowledge     Generate human-readable KNOWLEDGE.md
  import               Import graph from JSON
  rollback             Restore graph from snapshot
  conflicts            List or resolve entity conflicts
  freshness            Generate freshness report
  share                Share an entity
  history              Show temporal knowledge history
  download-model       Download ONNX embedding model
  enable-flagging      Enable mid-session flagging
  disable-flagging     Disable mid-session flagging
  server               Manage MCP server (start, stop, status)

Options:
  --version, -v        Show version
  --help, -h           Show this help
`);
}

/**
 * Open the graph database for the current working directory.
 * Shared by commands that need SiaDb access.
 */
async function openDb() {
	const { resolveRepoHash } = await import("@/capture/hook");
	const { openGraphDb } = await import("@/graph/semantic-db");
	const repoHash = resolveRepoHash(process.cwd());
	return openGraphDb(repoHash);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.includes("--version") || args.includes("-v")) {
		console.log(`sia v${VERSION}`);
		return;
	}

	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		printHelp();
		return;
	}

	const command = args[0];
	const rest = args.slice(1);

	switch (command) {
		// --- Self-contained commands (no DB needed) ---
		case "install": {
			const { siaInstall } = await import("@/cli/commands/install");
			const result = await siaInstall();
			console.log(JSON.stringify(result, null, 2));
			return;
		}
		case "reindex": {
			const { siaReindex } = await import("@/cli/commands/reindex");
			const result = await siaReindex();
			console.log(JSON.stringify(result, null, 2));
			return;
		}
		case "learn": {
			const { siaLearn } = await import("@/cli/commands/learn");
			const options: Record<string, unknown> = {};
			if (rest.includes("--incremental")) options.incremental = true;
			if (rest.includes("--force")) options.force = true;
			if (rest.includes("--quiet")) options.verbosity = "quiet";
			if (rest.includes("--interactive")) options.verbosity = "interactive";
			if (rest.includes("--verbose")) options.verbosity = "verbose";
			await siaLearn(options as any);
			return;
		}
		case "download-model": {
			const { downloadModel } = await import("@/cli/commands/download-model");
			const path = await downloadModel();
			console.log(`Model downloaded to: ${path}`);
			return;
		}
		case "enable-flagging": {
			const { enableFlagging } = await import("@/cli/commands/enable-flagging");
			await enableFlagging();
			console.log("Flagging enabled.");
			return;
		}
		case "disable-flagging": {
			const { disableFlagging } = await import("@/cli/commands/disable-flagging");
			await disableFlagging();
			console.log("Flagging disabled.");
			return;
		}

		// --- Commands with their own CLI dispatchers ---
		case "community":
			await runCommunityCommand(rest);
			return;
		case "sync": {
			const { runSync } = await import("@/cli/commands/sync");
			await runSync(rest);
			return;
		}
		case "team": {
			const { teamJoin, teamLeave, teamStatus } = await import("@/cli/commands/team");
			const sub = rest[0];
			if (sub === "join" && rest.length >= 3) {
				await teamJoin(rest[1], rest[2]);
			} else if (sub === "leave") {
				await teamLeave();
			} else if (sub === "status") {
				const status = await teamStatus();
				console.log(JSON.stringify(status, null, 2));
			} else {
				console.error("Usage: sia team <join|leave|status>");
			}
			return;
		}

		// --- Commands that need DB ---
		case "search": {
			const { searchGraph } = await import("@/cli/commands/search");
			const query = rest.join(" ");
			if (!query) {
				console.error("Usage: sia search <query>");
				return;
			}
			const db = await openDb();
			try {
				const results = await searchGraph(db, query);
				console.log(JSON.stringify(results, null, 2));
			} finally {
				await db.close();
			}
			return;
		}
		case "status": {
			const { runStatus } = await import("@/cli/commands/status");
			const db = await openDb();
			try {
				await runStatus(db);
			} finally {
				await db.close();
			}
			return;
		}
		case "stats": {
			const { getStats } = await import("@/cli/commands/stats");
			const db = await openDb();
			try {
				const result = await getStats(db);
				console.log(JSON.stringify(result, null, 2));
			} finally {
				await db.close();
			}
			return;
		}
		case "doctor": {
			const { runDoctor } = await import("@/cli/commands/doctor");
			const db = await openDb();
			try {
				const report = await runDoctor(db, process.cwd());
				console.log(JSON.stringify(report, null, 2));
			} finally {
				await db.close();
			}
			return;
		}
		case "digest": {
			const { generateDigest } = await import("@/cli/commands/digest");
			const db = await openDb();
			try {
				const result = await generateDigest(db);
				console.log(JSON.stringify(result, null, 2));
			} finally {
				await db.close();
			}
			return;
		}
		case "graph": {
			const { generateGraphVisualization } = await import("@/cli/commands/graph");
			const db = await openDb();
			try {
				const output = await generateGraphVisualization(db);
				console.log(output);
			} finally {
				await db.close();
			}
			return;
		}
		case "visualize-live": {
			const { runVisualizeLive } = await import("@/cli/commands/visualize-live");
			const db = await openDb();
			try {
				await runVisualizeLive(db, rest);
			} finally {
				await db.close();
			}
			return;
		}
		case "prune": {
			const { pruneDryRun, pruneConfirm } = await import("@/cli/commands/prune");
			const db = await openDb();
			try {
				if (rest.includes("--confirm")) {
					const removed = await pruneConfirm(db);
					console.log(`Pruned ${removed} entities.`);
				} else {
					const candidates = await pruneDryRun(db);
					console.log(JSON.stringify(candidates, null, 2));
					if (candidates.length > 0) {
						console.log(`\nRun 'sia prune --confirm' to remove ${candidates.length} entities.`);
					}
				}
			} finally {
				await db.close();
			}
			return;
		}
		case "export-knowledge": {
			const { runExportKnowledge } = await import("@/cli/commands/export-knowledge");
			await runExportKnowledge(rest);
			return;
		}
		case "export": {
			const { exportToFile, exportGraph } = await import("@/cli/commands/export");
			const db = await openDb();
			try {
				const outputPath = rest[0];
				if (outputPath) {
					const path = await exportToFile(db, outputPath);
					console.log(`Exported to: ${path}`);
				} else {
					const data = await exportGraph(db);
					console.log(JSON.stringify(data, null, 2));
				}
			} finally {
				await db.close();
			}
			return;
		}
		case "import": {
			const { importFromFile } = await import("@/cli/commands/import");
			const filePath = rest[0];
			const mode = rest.includes("--replace") ? "replace" as const : "merge" as const;
			if (!filePath) {
				console.error("Usage: sia import <file> [--replace]");
				return;
			}
			const db = await openDb();
			try {
				const result = await importFromFile(db, filePath, mode);
				console.log(JSON.stringify(result, null, 2));
			} finally {
				await db.close();
			}
			return;
		}
		case "rollback": {
			const { rollbackGraph } = await import("@/cli/commands/rollback");
			const { resolveRepoHash } = await import("@/capture/hook");
			const repoHash = resolveRepoHash(process.cwd());
			const db = await openDb();
			try {
				const result = await rollbackGraph(db, repoHash);
				console.log(JSON.stringify(result, null, 2));
			} finally {
				await db.close();
			}
			return;
		}
		case "conflicts": {
			const { listConflicts, resolveConflict } = await import("@/cli/commands/conflicts");
			const db = await openDb();
			try {
				if (rest[0] === "resolve" && rest[1] && rest[2]) {
					await resolveConflict(db, rest[1], rest[2]);
					console.log("Conflict resolved.");
				} else {
					const conflicts = await listConflicts(db);
					console.log(JSON.stringify(conflicts, null, 2));
				}
			} finally {
				await db.close();
			}
			return;
		}
		case "freshness": {
			const { generateFreshnessReport } = await import("@/cli/commands/freshness");
			const db = await openDb();
			try {
				const report = await generateFreshnessReport(db);
				console.log(JSON.stringify(report, null, 2));
			} finally {
				await db.close();
			}
			return;
		}
		case "share": {
			const { shareEntity } = await import("@/cli/commands/share");
			const entityId = rest[0];
			if (!entityId) {
				console.error("Usage: sia share <entity-id>");
				return;
			}
			const db = await openDb();
			try {
				await shareEntity(db, entityId);
				console.log(`Entity ${entityId} shared.`);
			} finally {
				await db.close();
			}
			return;
		}
		case "workspace": {
			const mod = await import("@/cli/commands/workspace");
			const db = await openDb();
			try {
				const sub = rest[0];
				if (sub === "create" && rest[1]) {
					const id = await mod.workspaceCreate(db, rest[1]);
					console.log(`Workspace created: ${id}`);
				} else if (sub === "list") {
					const items = await mod.workspaceList(db);
					console.log(JSON.stringify(items, null, 2));
				} else if (sub === "add" && rest[1] && rest[2]) {
					await mod.workspaceAdd(db, rest[1], rest[2]);
					console.log("Repository added to workspace.");
				} else if (sub === "remove" && rest[1] && rest[2]) {
					await mod.workspaceRemove(db, rest[1], rest[2]);
					console.log("Repository removed from workspace.");
				} else {
					console.error("Usage: sia workspace <create|list|add|remove> [args]");
				}
			} finally {
				await db.close();
			}
			return;
		}
		case "history": {
			const { runHistory } = await import("@/cli/commands/history");
			await runHistory(rest);
			return;
		}
		case "server": {
			const { serverStart, serverStop, serverStatus } = await import("@/cli/commands/server");
			const sub = rest[0];
			if (sub === "start") {
				const config = serverStart();
				console.log(JSON.stringify(config, null, 2));
			} else if (sub === "stop") {
				const config = serverStop();
				console.log(JSON.stringify(config, null, 2));
			} else if (sub === "status") {
				const config = serverStatus();
				console.log(JSON.stringify(config, null, 2));
			} else {
				console.error("Usage: sia server <start|stop|status>");
			}
			return;
		}
		default:
			console.error(`Unknown command: ${command}. Run 'sia --help' for usage.`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
