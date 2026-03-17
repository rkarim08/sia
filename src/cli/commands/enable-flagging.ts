import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getConfig, writeConfig } from "@/shared/config";

/**
 * Enable the sia_flag capture pathway.
 *
 * 1. Persists `enableFlagging: true` in config.
 * 2. Swaps the installed CLAUDE.md to the flagging-enabled template
 *    (contains the expanded sia_flag section in Step 4).
 *
 * Idempotent — running twice is a no-op.
 */
export async function enableFlagging(opts?: { siaHome?: string; cwd?: string }): Promise<void> {
	const config = getConfig(opts?.siaHome);

	if (config.enableFlagging === true) {
		return;
	}

	writeConfig({ enableFlagging: true }, opts?.siaHome);

	// Resolve the flagging template relative to *this* file's directory.
	const templatePath = resolve(import.meta.dirname, "../../agent/claude-md-template-flagging.md");
	const template = readFileSync(templatePath, "utf-8");

	const cwd = opts?.cwd ?? process.cwd();
	const claudeDir = join(cwd, ".claude");
	mkdirSync(claudeDir, { recursive: true });

	writeFileSync(join(claudeDir, "CLAUDE.md"), template, "utf-8");

	console.log("Flagging enabled. CLAUDE.md updated with sia_flag section.");
}
