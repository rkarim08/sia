// Module: community — CLI for printing community structure

import { resolveRepoHash } from "@/capture/hook";
import { detectCommunities } from "@/community/leiden";
import { buildSummaryTree } from "@/community/raptor";
import { summarizeCommunities } from "@/community/summarize";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { getConfig } from "@/shared/config";

interface CliCommunity {
	id: string;
	summary: string | null;
	memberCount: number;
	parentId: string | null;
}

interface CliEntity {
	name: string;
	importance: number;
}

export interface CommunityCliOptions {
	packagePath?: string;
}

async function countCommunities(db: SiaDb): Promise<number> {
	const result = await db.execute(`SELECT COUNT(*) as count FROM communities`);
	return Number((result.rows[0] as { count: number }).count ?? 0);
}

async function loadCommunities(
	db: SiaDb,
	level: number,
	packagePath?: string,
): Promise<CliCommunity[]> {
	const params: unknown[] = [level];
	let wherePackage = "";
	if (packagePath) {
		wherePackage = "AND (package_path = ? OR package_path IS NULL)";
		params.push(packagePath);
	}
	const result = await db.execute(
		`SELECT id, summary, member_count as memberCount, parent_id as parentId
                 FROM communities
                 WHERE level = ?
                 ${wherePackage}
                 ORDER BY memberCount DESC`,
		params,
	);
	return result.rows as unknown as CliCommunity[];
}

async function topEntities(db: SiaDb, communityId: string): Promise<CliEntity[]> {
	const result = await db.execute(
		`SELECT e.name, e.importance
                 FROM community_members cm
                 JOIN entities e ON cm.entity_id = e.id
                 WHERE cm.community_id = ?
                 ORDER BY e.importance DESC
                 LIMIT 5`,
		[communityId],
	);
	return result.rows as unknown as CliEntity[];
}

export async function formatCommunityTree(
	db: SiaDb,
	opts: CommunityCliOptions = {},
): Promise<string> {
	const level2 = await loadCommunities(db, 2, opts.packagePath);
	const level1 = await loadCommunities(db, 1, opts.packagePath);

	if (level2.length === 0 && level1.length === 0) {
		return "No communities yet. Run detection first.";
	}

	const lines: string[] = [];

	for (const community of level2) {
		const header = `Community ${community.id.slice(0, 8)} — members: ${community.memberCount}`;
		lines.push(header);
		if (community.summary) {
			lines.push(`  ${community.summary}`);
		}

		const children = level1.filter((c) => c.parentId === community.id);
		for (const child of children) {
			const childTitle = `  - ${child.summary ?? child.id.slice(0, 8)} (${child.memberCount} members)`;
			lines.push(childTitle);
			const entities = await topEntities(db, child.id);
			if (entities.length === 0) {
				lines.push("    (no entities)");
			} else {
				for (const entity of entities) {
					lines.push(`    - ${entity.name} [importance ${entity.importance.toFixed(2)}]`);
				}
			}
		}
	}

	return lines.join("\n");
}

export async function runCommunityCommand(args: string[]): Promise<void> {
	let packagePath: string | undefined;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--package" || args[i] === "-p") {
			packagePath = args[i + 1];
			i++;
		}
	}

	const repoHash = resolveRepoHash(process.cwd());
	const db = openGraphDb(repoHash);
	const config = getConfig();

	try {
		const existing = await countCommunities(db);
		if (existing === 0) {
			await detectCommunities(db);
			await summarizeCommunities(db, { airGapped: config.airGapped });
			await buildSummaryTree(db);
		}
		const output = await formatCommunityTree(db, { packagePath });
		console.log(output);
	} finally {
		await db.close();
	}
}
