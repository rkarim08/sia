import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type IndexResult, indexRepository } from "@/ast/indexer";
import { inferPackagePath } from "@/capture/pipeline";
import { openMetaDb, registerRepo } from "@/graph/meta-db";
import { openGraphDb } from "@/graph/semantic-db";
import { getConfig } from "@/shared/config";
import { detectApiContracts, writeDetectedContracts } from "@/workspace/api-contracts";
import { detectMonorepoPackages, registerMonorepoPackages } from "@/workspace/detector";

export interface ReindexOptions {
	cwd?: string;
	siaHome?: string;
	dryRun?: boolean;
}

export interface ReindexResult extends IndexResult {
	repoHash: string;
	dryRun: boolean;
	packagesDetected: number;
	contractsDetected: number;
	/** Number of existing entities whose package_path was backfilled (Task 14.12). */
	packagePathBackfilled: number;
}

function findRepoRoot(startDir: string): string | null {
	let dir = resolve(startDir);
	const root = resolve("/");
	while (dir !== root) {
		if (existsSync(join(dir, ".git"))) {
			return dir;
		}
		const parent = resolve(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}
	if (existsSync(join(dir, ".git"))) {
		return dir;
	}
	return null;
}

export async function siaReindex(opts: ReindexOptions = {}): Promise<ReindexResult> {
	const cwd = opts.cwd ?? process.cwd();
	const repoRoot = findRepoRoot(cwd);
	if (!repoRoot) {
		throw new Error(`No .git directory found from ${cwd}`);
	}

	const resolvedRoot = resolve(repoRoot);
	const repoHash = createHash("sha256").update(resolvedRoot).digest("hex");
	const isDryRun = opts.dryRun ?? false;
	const prefix = isDryRun ? "(dry-run) " : "";

	const config = getConfig(opts.siaHome);
	const db = openGraphDb(repoHash, opts.siaHome);

	let packagesDetected = 0;
	let contractsDetected = 0;

	try {
		// Re-detect monorepo structure and API contracts
		if (!isDryRun) {
			const metaDb = openMetaDb(opts.siaHome);
			try {
				const repoId = await registerRepo(metaDb, resolvedRoot);

				const packages = await detectMonorepoPackages(resolvedRoot);
				if (packages.length > 0) {
					await registerMonorepoPackages(metaDb, repoId, resolvedRoot, packages);
					packagesDetected = packages.length;
				}

				const contracts = await detectApiContracts(resolvedRoot);
				if (contracts.length > 0) {
					await writeDetectedContracts(metaDb, repoId, contracts);
					contractsDetected = contracts.length;
				}
			} finally {
				await metaDb.close();
			}
		}

		const result = await indexRepository(resolvedRoot, db, config, {
			dryRun: isDryRun,
			repoHash,
			onProgress: ({ filesProcessed, entitiesCreated, file }) => {
				console.log(`${prefix}[${filesProcessed}] ${file ?? "..."} (${entitiesCreated} entities)`);
			},
		});

		// Task 14.12: backfill package_path for existing active entities that have
		// file_paths but no package_path. Without this, attention fusion and community
		// detection disproportionately weight unscoped entities in monorepos.
		let packagePathBackfilled = 0;
		if (!isDryRun) {
			try {
				const { rows: rowsNeedingPackagePath } = await db.execute(
					`SELECT id, file_paths FROM graph_nodes
					 WHERE package_path IS NULL
					   AND file_paths IS NOT NULL
					   AND file_paths != '[]'
					   AND archived_at IS NULL
					   AND t_valid_until IS NULL`,
				);

				for (const row of rowsNeedingPackagePath) {
					const entityId = row.id as string;
					try {
						const filePaths = JSON.parse(row.file_paths as string) as unknown;
						if (
							Array.isArray(filePaths) &&
							filePaths.length > 0 &&
							typeof filePaths[0] === "string"
						) {
							const packagePath = inferPackagePath(filePaths[0] as string, resolvedRoot);
							if (packagePath) {
								await db.execute("UPDATE graph_nodes SET package_path = ? WHERE id = ?", [
									packagePath,
									entityId,
								]);
								packagePathBackfilled++;
							}
						}
					} catch (err) {
						console.error(
							`[sia] reindex: failed to backfill package_path for ${entityId}:`,
							err instanceof Error ? err.message : String(err),
						);
					}
				}

				if (packagePathBackfilled > 0) {
					console.log(`${prefix}Backfilled package_path for ${packagePathBackfilled} entities.`);
				}
			} catch (err) {
				console.error(
					"[sia] reindex: package_path backfill pass failed:",
					err instanceof Error ? err.message : String(err),
				);
			}
		}

		console.log(
			`${prefix}Reindex complete: ${result.filesProcessed} files, ${result.entitiesCreated} entities, ${packagesDetected} packages, ${contractsDetected} contracts.`,
		);
		if (result.entitiesCreated === 0 && result.filesProcessed > 0) {
			console.warn(
				"Warning: 0 entities created despite processing files. Run 'sia doctor' to check tree-sitter status.",
			);
		}

		return {
			...result,
			repoHash,
			dryRun: isDryRun,
			packagesDetected,
			contractsDetected,
			packagePathBackfilled,
		};
	} finally {
		await db.close();
	}
}
