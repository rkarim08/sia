import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type IndexResult, indexRepository } from "@/ast/indexer";
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
		};
	} finally {
		await db.close();
	}
}
