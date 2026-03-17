import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getConfig, writeConfig } from "@/shared/config";

/**
 * Disable the sia_flag capture pathway.
 *
 * 1. Persists `enableFlagging: false` in config.
 * 2. Swaps the installed CLAUDE.md back to the base template
 *    (Step 4 reverts to the conditional check).
 *
 * Idempotent — running twice is a no-op.
 */
export async function disableFlagging(opts?: { siaHome?: string; cwd?: string }): Promise<void> {
	const config = getConfig(opts?.siaHome);

	if (config.enableFlagging === false) {
		return;
	}

	writeConfig({ enableFlagging: false }, opts?.siaHome);

	// Resolve the base template relative to *this* file's directory.
	const templatePath = resolve(import.meta.dirname, "../../agent/claude-md-template.md");
	const template = readFileSync(templatePath, "utf-8");

	const cwd = opts?.cwd ?? process.cwd();
	const claudeDir = join(cwd, ".claude");
	mkdirSync(claudeDir, { recursive: true });

	writeFileSync(join(claudeDir, "CLAUDE.md"), template, "utf-8");

	console.log("Flagging disabled. CLAUDE.md restored to base template.");
}
