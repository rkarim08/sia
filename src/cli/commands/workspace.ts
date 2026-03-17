// Module: workspace — Workspace CLI subcommands (create, list, add, remove, show)
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { SiaDb } from "@/graph/db-interface";
import {
	addRepoToWorkspace,
	createWorkspace,
	getWorkspaceContractCount,
	getWorkspaceRepos,
	listWorkspaces,
	registerRepo,
	removeRepoFromWorkspace,
	resolveWorkspaceName,
	type WorkspaceListItem,
} from "@/graph/meta-db";
import { detectApiContracts, writeDetectedContracts } from "@/workspace/api-contracts";

/**
 * Create a workspace.
 */
export async function workspaceCreate(db: SiaDb, name: string): Promise<string> {
	return createWorkspace(db, name);
}

/**
 * List all workspaces with member counts.
 */
export async function workspaceList(db: SiaDb): Promise<WorkspaceListItem[]> {
	return listWorkspaces(db);
}

/**
 * Add a repo to a workspace. Triggers API contract auto-detection.
 */
export async function workspaceAdd(
	db: SiaDb,
	workspaceName: string,
	repoPath: string,
): Promise<void> {
	const wsId = await resolveWorkspaceName(db, workspaceName);
	if (!wsId) throw new Error(`Workspace '${workspaceName}' not found`);

	const repoId = await registerRepo(db, repoPath);
	await addRepoToWorkspace(db, wsId, repoId);

	// Auto-detect API contracts
	const contracts = await detectApiContracts(resolve(repoPath));
	if (contracts.length > 0) {
		await writeDetectedContracts(db, repoId, contracts);
	}
}

/**
 * Remove a repo from a workspace.
 */
export async function workspaceRemove(
	db: SiaDb,
	workspaceName: string,
	repoPath: string,
): Promise<void> {
	const wsId = await resolveWorkspaceName(db, workspaceName);
	if (!wsId) throw new Error(`Workspace '${workspaceName}' not found`);

	const resolved = resolve(repoPath);
	const repoId = createHash("sha256").update(resolved).digest("hex");
	await removeRepoFromWorkspace(db, wsId, repoId);
}

/** Shape returned by workspaceShow. */
export interface WorkspaceShowInfo {
	name: string;
	id: string;
	members: Array<{ id: string; path: string; name: string | null }>;
	contractCount: number;
	crossRepoEdgeCount: number;
}

/**
 * Show workspace details: members, contracts, cross-repo edge count.
 */
export async function workspaceShow(
	metaDb: SiaDb,
	bridgeDb: SiaDb,
	workspaceName: string,
): Promise<WorkspaceShowInfo> {
	const wsId = await resolveWorkspaceName(metaDb, workspaceName);
	if (!wsId) throw new Error(`Workspace '${workspaceName}' not found`);

	const repos = await getWorkspaceRepos(metaDb, wsId);
	const contractCount = await getWorkspaceContractCount(metaDb, wsId);

	// Count cross-repo edges for workspace repos
	let crossRepoEdgeCount = 0;
	if (repos.length > 0) {
		const repoIds = repos.map((r) => r.id as string);
		const placeholders = repoIds.map(() => "?").join(", ");
		const edgeResult = await bridgeDb.execute(
			`SELECT COUNT(*) as cnt FROM cross_repo_edges
			 WHERE (source_repo_id IN (${placeholders}) OR target_repo_id IN (${placeholders}))
			   AND t_valid_until IS NULL`,
			[...repoIds, ...repoIds],
		);
		crossRepoEdgeCount = (edgeResult.rows[0]?.cnt as number) ?? 0;
	}

	return {
		name: workspaceName,
		id: wsId,
		members: repos.map((r) => ({
			id: r.id as string,
			path: r.path as string,
			name: (r.name as string | null) ?? null,
		})),
		contractCount,
		crossRepoEdgeCount,
	};
}
