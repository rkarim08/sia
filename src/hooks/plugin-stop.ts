#!/usr/bin/env bun
// Plugin hook wrapper: Stop
//
// Reads Claude Code Stop event from stdin, runs pattern detection
// on recent transcript, captures uncaptured knowledge.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import { createStopHandler } from "@/hooks/handlers/stop";
import { parsePluginHookEvent, readStdin } from "@/hooks/plugin-common";

async function main() {
	try {
		const input = await readStdin();
		if (!input.trim()) {
			process.exit(0);
		}

		const event = parsePluginHookEvent(input);
		const cwd = event.cwd || process.cwd();
		const repoHash = resolveRepoHash(cwd);
		const db = openGraphDb(repoHash);

		try {
			const handler = createStopHandler(db);
			const result = await handler(event);
			process.stdout.write(JSON.stringify(result));

			// Save session subgraph for resume
			try {
				const { saveSubgraph } = await import("@/graph/session-resume");

				const recentNodes = await db.execute(
					`SELECT id, type, name, summary, kind, trust_tier, file_paths
					 FROM graph_nodes
					 WHERE session_id = ? OR last_accessed > ?
					 ORDER BY last_accessed DESC
					 LIMIT 20`,
					[event.session_id, Date.now() - 3600000],
				);

				const subgraph = {
					entities: recentNodes.rows,
					timestamp: Date.now(),
				};

				await saveSubgraph(
					db,
					event.session_id,
					JSON.stringify(subgraph),
					null,
					0,
				);
				process.stderr.write("sia: saved session subgraph for resume\n");
			} catch (err) {
				process.stderr.write(`sia: session save failed (non-fatal): ${err}\n`);
			}
		} finally {
			await db.close();
		}
	} catch (err) {
		process.stderr.write(`sia Stop hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
