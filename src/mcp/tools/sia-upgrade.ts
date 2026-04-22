// Module: sia-upgrade — Self-update handler with npm/git/binary strategies

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type { SiaDb } from "@/graph/db-interface";
import { buildNextSteps, type NextStep } from "@/mcp/next-steps";
import type { SiaUpgradeInput } from "@/mcp/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InstallationType = "npm" | "git" | "binary";

export interface UpdateStrategy {
	name: InstallationType;
	detect(): boolean;
	currentVersion(): string;
	update(target: string): void;
	rollback(snapshot: string): void;
}

export interface SiaUpgradeResult {
	previousVersion?: string;
	newVersion?: string;
	strategy?: string;
	migrationsRun?: number;
	hooksReconfigured?: boolean;
	vssRebuilt?: boolean;
	dryRun?: boolean;
	error?: string;
	next_steps?: NextStep[];
}

// ---------------------------------------------------------------------------
// NpmUpdateStrategy
// ---------------------------------------------------------------------------

export class NpmUpdateStrategy implements UpdateStrategy {
	name: InstallationType = "npm";

	constructor(private readonly siaRoot: string) {}

	detect(): boolean {
		return existsSync(join(this.siaRoot, "node_modules", "sia"));
	}

	currentVersion(): string {
		const pkgPath = join(this.siaRoot, "node_modules", "sia", "package.json");
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
				return pkg.version ?? "unknown";
			} catch (err) {
				console.error(`[sia-upgrade] Failed to read version: ${(err as Error).message}`);
				return "unknown";
			}
		}
		return "unknown";
	}

	update(target: string): void {
		const pkg = target ? `sia@${target}` : "sia";
		const result = spawnSync("bun", ["update", pkg], { encoding: "utf-8" });
		if (result.status !== 0) {
			throw new Error(result.stderr ?? "bun update failed");
		}
	}

	rollback(snapshot: string): void {
		const result = spawnSync("bun", ["add", `sia@${snapshot}`], { encoding: "utf-8" });
		if (result.status !== 0) {
			throw new Error(result.stderr ?? "bun add rollback failed");
		}
	}
}

// ---------------------------------------------------------------------------
// GitUpdateStrategy
// ---------------------------------------------------------------------------

export class GitUpdateStrategy implements UpdateStrategy {
	name: InstallationType = "git";

	constructor(private readonly siaRoot: string) {}

	detect(): boolean {
		return existsSync(join(this.siaRoot, ".git"));
	}

	currentVersion(): string {
		const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
			cwd: this.siaRoot,
			encoding: "utf-8",
		});
		if (result.status === 0 && result.stdout) {
			return result.stdout.trim();
		}
		console.error(
			`[sia-upgrade] Failed to read version: ${result.stderr?.trim() ?? "git rev-parse failed"}`,
		);
		return "unknown";
	}

	update(_target: string): void {
		const pull = spawnSync("git", ["pull", "--ff-only", "origin", "main"], {
			cwd: this.siaRoot,
			encoding: "utf-8",
		});
		if (pull.status !== 0) {
			throw new Error(pull.stderr ?? "git pull failed");
		}

		const install = spawnSync("bun", ["install"], {
			cwd: this.siaRoot,
			encoding: "utf-8",
		});
		if (install.status !== 0) {
			throw new Error(install.stderr ?? "bun install failed");
		}
	}

	rollback(snapshot: string): void {
		const result = spawnSync("git", ["reset", "--hard", snapshot], {
			cwd: this.siaRoot,
			encoding: "utf-8",
		});
		if (result.status !== 0) {
			throw new Error(result.stderr ?? "git reset failed");
		}
	}
}

// ---------------------------------------------------------------------------
// BinaryUpdateStrategy
// ---------------------------------------------------------------------------

export class BinaryUpdateStrategy implements UpdateStrategy {
	name: InstallationType = "binary";

	detect(): boolean {
		// fallback — always detects
		return true;
	}

	currentVersion(): string {
		return "unknown";
	}

	update(_target: string): void {
		throw new Error("not yet implemented");
	}

	rollback(_snapshot: string): void {
		throw new Error("not yet implemented");
	}
}

// ---------------------------------------------------------------------------
// detectInstallationType
// ---------------------------------------------------------------------------

export function detectInstallationType(siaRoot: string): InstallationType {
	// npm preferred over git when both exist
	const npm = new NpmUpdateStrategy(siaRoot);
	if (npm.detect()) return "npm";

	const git = new GitUpdateStrategy(siaRoot);
	if (git.detect()) return "git";

	return "binary";
}

// ---------------------------------------------------------------------------
// handleSiaUpgrade
// ---------------------------------------------------------------------------

export async function handleSiaUpgrade(
	_db: SiaDb,
	input: z.infer<typeof SiaUpgradeInput>,
	config?: { siaRoot?: string; upgradeReleaseUrl?: string },
): Promise<SiaUpgradeResult> {
	const siaRoot = config?.siaRoot ?? process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
	const targetVersion = input.target_version ?? "";
	const dryRun = input.dry_run ?? false;

	// 1. Auto-detect installation type
	const type = detectInstallationType(siaRoot);

	// Build the strategy instance
	let strategy: UpdateStrategy;
	if (type === "npm") {
		strategy = new NpmUpdateStrategy(siaRoot);
	} else if (type === "git") {
		strategy = new GitUpdateStrategy(siaRoot);
	} else {
		strategy = new BinaryUpdateStrategy();
	}

	// 2. Snapshot current version
	const previousVersion = strategy.currentVersion();

	// 3. If dry_run → return early
	if (dryRun) {
		const dryNext = buildNextSteps("sia_upgrade", { hasFailure: false });
		const dryResp: SiaUpgradeResult = { previousVersion, strategy: type, dryRun: true };
		if (dryNext.length > 0) dryResp.next_steps = dryNext;
		return dryResp;
	}

	// Guard: if version is unknown, rollback would be impossible
	if (previousVersion === "unknown") {
		const unknownNext = buildNextSteps("sia_upgrade", { hasFailure: true });
		const unknownResp: SiaUpgradeResult = {
			previousVersion,
			strategy: type,
			error: "Cannot determine current version — rollback would be impossible. Aborting upgrade.",
		};
		if (unknownNext.length > 0) unknownResp.next_steps = unknownNext;
		return unknownResp;
	}

	// 4. Try update → on failure, try rollback
	try {
		strategy.update(targetVersion);
	} catch (updateErr) {
		// Attempt rollback
		let rollbackMsg = "";
		try {
			strategy.rollback(previousVersion);
			rollbackMsg = " (rolled back to previous version)";
		} catch (rollbackErr) {
			rollbackMsg = ` (rollback also failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)})`;
		}

		const failNext = buildNextSteps("sia_upgrade", { hasFailure: true });
		const failResp: SiaUpgradeResult = {
			previousVersion,
			strategy: type,
			error: `${updateErr instanceof Error ? updateErr.message : String(updateErr)}${rollbackMsg}`,
		};
		if (failNext.length > 0) failResp.next_steps = failNext;
		return failResp;
	}

	// 5. Return success result
	const newVersion = strategy.currentVersion();
	const nextSteps = buildNextSteps("sia_upgrade", { hasFailure: false });
	const response: SiaUpgradeResult = {
		previousVersion,
		newVersion,
		strategy: type,
		migrationsRun: 0,
		hooksReconfigured: false,
		vssRebuilt: false,
	};
	if (nextSteps.length > 0) response.next_steps = nextSteps;
	return response;
}
