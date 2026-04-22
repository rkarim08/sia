#!/usr/bin/env bun
// Plugin hook wrapper: SessionStart
//
// Injects recent decisions, conventions, and known bugs as context
// at the beginning of a Claude Code session.
// Also ensures the MCP server is configured in the project.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRepoHash } from "@/capture/hook";
import { incrementalReindex, readStoredHead } from "@/capture/incremental-reindexer";
import { openGraphDb } from "@/graph/semantic-db";
import { buildSessionContext, formatSessionContext } from "@/hooks/handlers/session-start";
import { parsePluginHookEvent, readStdin } from "@/hooks/plugin-common";
import type { HookEvent } from "@/hooks/types";
import { runSessionStart as runNousSessionStart } from "@/nous/self-monitor";
import { DEFAULT_NOUS_CONFIG } from "@/nous/types";
import { getConfig } from "@/shared/config";

/**
 * Ensures the SIA MCP server is configured in the project or user settings.
 * If the plugin auto-discovery doesn't register the MCP server, this writes
 * the config so the user doesn't need to do it manually.
 */
function ensureMcpConfig(cwd: string): void {
	const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
	const pluginData = process.env.CLAUDE_PLUGIN_DATA;
	if (!pluginRoot) return;

	// Check project-level .mcp.json
	const projectMcpPath = join(cwd, ".mcp.json");
	if (existsSync(projectMcpPath)) {
		try {
			const existing = JSON.parse(readFileSync(projectMcpPath, "utf8"));
			// Check both flat and wrapped formats
			if (existing.sia || existing.mcpServers?.sia) return; // Already configured
		} catch {
			// Invalid JSON — don't touch it
			return;
		}
	}

	// Check user-level settings
	const homeDir = process.env.HOME || process.env.USERPROFILE || "";
	const userSettingsPath = join(homeDir, ".claude", "settings.json");
	if (existsSync(userSettingsPath)) {
		try {
			const settings = JSON.parse(readFileSync(userSettingsPath, "utf8"));
			if (settings.mcpServers?.sia) return; // Already configured at user level
		} catch {
			// Ignore
		}
	}

	// Not configured anywhere — write to project .mcp.json
	const siaConfig = {
		command: "bash",
		args: [`${pluginRoot}/scripts/start-mcp.sh`],
		env: {
			SIA_HOME: pluginData || `${homeDir}/.sia`,
			CLAUDE_PLUGIN_DATA: pluginData || `${homeDir}/.sia`,
			CLAUDE_PLUGIN_ROOT: pluginRoot,
		},
	};

	try {
		let mcpJson: Record<string, unknown> = {};
		if (existsSync(projectMcpPath)) {
			mcpJson = JSON.parse(readFileSync(projectMcpPath, "utf8"));
		}
		mcpJson.sia = siaConfig;
		writeFileSync(projectMcpPath, `${JSON.stringify(mcpJson, null, "\t")}\n`);
		process.stderr.write("[sia] MCP server auto-configured in .mcp.json\n");
	} catch (err) {
		process.stderr.write(`[sia] MCP auto-config failed (non-fatal): ${err}\n`);
	}
}

/**
 * First-run hint: if no T0 embedding model is present, nudge the user to
 * download it for better search quality. Degrades silently on any error.
 */
function getModelInstallHint(): string {
	try {
		const modelPath = join(
			homedir(),
			".sia",
			"models",
			"bge-small-en-v1.5",
			"model_quantized.onnx",
		);
		if (existsSync(modelPath)) return "";
		return "\n💡 Transformer models not installed — run `sia download-model` for better search quality (55MB).\n";
	} catch {
		return "";
	}
}

async function main() {
	try {
		const input = await readStdin();
		// SessionStart may be invoked without event data on initial install
		let event: HookEvent;
		if (input.trim()) {
			event = parsePluginHookEvent(input);
		} else {
			event = {
				session_id: "unknown",
				cwd: process.cwd(),
				transcript_path: "",
				hook_event_name: "SessionStart",
			};
		}

		const cwd = event.cwd || process.cwd();

		// Ensure MCP server is configured for this project
		ensureMcpConfig(cwd);
		const repoHash = resolveRepoHash(cwd);
		const db = openGraphDb(repoHash);

		// Incremental reindex: detect changes since last session
		try {
			const config = getConfig();
			const repoDataDir = join(config.repoDir, repoHash);
			const storedHead = readStoredHead(repoDataDir);
			const reindexResult = await incrementalReindex(db, cwd, repoHash, config, storedHead);
			if (reindexResult.triggered && reindexResult.filesReparsed > 0) {
				process.stderr.write(
					`[sia] Auto-reindex: ${reindexResult.filesChanged} files changed since last session (${reindexResult.filesReparsed} re-parsed, ${reindexResult.filesSkippedByHash} unchanged content)${reindexResult.reason ? ` — ${reindexResult.reason}` : ""}\n`,
				);
			}
		} catch (err) {
			process.stderr.write(`[sia] Auto-reindex failed (non-fatal): ${err}\n`);
		}

		try {
			const isResume = event.source === "resume";
			const context = await buildSessionContext(db, cwd, isResume);
			let formatted = formatSessionContext(context);

			// First-run UX: hint to download T0 models if missing.
			formatted += getModelInstallHint();

			// Nous: run self-monitor and inject drift warning if needed.
			// Must not break SessionStart — any failure is logged and ignored.
			try {
				const config = getConfig();
				const nousConfig = config.nous ?? DEFAULT_NOUS_CONFIG;
				if (nousConfig.enabled && event.session_id && event.session_id !== "unknown") {
					const nousResult = await runNousSessionStart(
						db,
						{ session_id: event.session_id, cwd },
						nousConfig,
					);
					if (nousResult.driftWarning) {
						formatted += `\n${nousResult.driftWarning}\n`;
					}
				}
			} catch (err) {
				process.stderr.write(`[Nous] SessionStart error: ${err}\n`);
			}

			// Load previous session subgraph if resuming
			if (isResume && event.session_id && event.session_id !== "unknown") {
				try {
					const { loadSubgraph } = await import("@/graph/session-resume");
					const resume = await loadSubgraph(db, event.session_id);
					if (resume) {
						const subgraph = JSON.parse(resume.subgraph_json);
						const entities = subgraph.entities as Array<{
							name: string;
							summary: string;
							type: string;
						}>;
						if (entities.length > 0) {
							formatted += "\n## Previous Session Context\n";
							formatted += "These entities were active in your previous session:\n\n";
							for (const entity of entities.slice(0, 10)) {
								formatted += `- **${entity.name}** (${entity.type}): ${entity.summary || "no summary"}\n`;
							}
						}
					}
				} catch (err) {
					process.stderr.write(`sia: session resume load failed (non-fatal): ${err}\n`);
				}
			}

			// SessionStart hooks output to stdout — Claude Code injects
			// the output as context into the conversation.
			process.stdout.write(formatted);
		} finally {
			await db.close();
		}
	} catch (err) {
		process.stderr.write(`sia SessionStart hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
