import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type IndexResult, indexRepository } from "@/ast/indexer";
import { openGraphDb } from "@/graph/semantic-db";
import { getConfig } from "@/shared/config";

export interface ReindexOptions {
	cwd?: string;
	siaHome?: string;
	dryRun?: boolean;
}

export interface ReindexResult extends IndexResult {
	repoHash: string;
	dryRun: boolean;
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

	const config = getConfig(opts.siaHome);
	const db = openGraphDb(repoHash, opts.siaHome);

	try {
		const result = await indexRepository(resolvedRoot, db, config, {
			dryRun: opts.dryRun ?? false,
			repoHash,
			onProgress: ({ filesProcessed, entitiesCreated, cacheHits }) => {
				console.log(
					`Indexed ${filesProcessed} files (${entitiesCreated} entities, ${cacheHits} cache hits)`,
				);
			},
		});

		console.log(
			`Reindex ${opts.dryRun ? "(dry-run) " : ""}complete: ${result.filesProcessed} files, ${
				result.entitiesCreated
			} entities.`,
		);

		return { ...result, repoHash, dryRun: opts.dryRun ?? false };
	} finally {
		await db.close();
	}
}
