// Module: meta-db — Meta database opener and workspace/repo registry CRUD

import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { BunSqliteDb, SiaDb } from "@/graph/db-interface";
import { runMigrations } from "@/graph/semantic-db";
import { SIA_HOME } from "@/shared/config";

/**
 * Open (or create) the global meta database.
 * Resolves to `{siaHome}/meta.db` (not under repos/) and applies
 * migrations from the `migrations/meta` directory.
 */
export function openMetaDb(siaHome?: string): BunSqliteDb {
	const home = siaHome ?? SIA_HOME;
	const dbPath = join(home, "meta.db");
	const migrationsDir = resolve(import.meta.dirname, "../../migrations/meta");
	return runMigrations(dbPath, migrationsDir);
}

// ---------------------------------------------------------------------------
// Repo registry
// ---------------------------------------------------------------------------

/**
 * Register a repository by its absolute path.
 * Computes a SHA-256 hash of the resolved path as the repo id.
 * Idempotent — if the repo already exists, updates `last_accessed`.
 * Returns the repo id (the hash).
 */
export async function registerRepo(db: SiaDb, path: string): Promise<string> {
	const resolved = resolve(path);
	const id = createHash("sha256").update(resolved).digest("hex");
	const now = Date.now();

	await db.execute(
		`INSERT INTO repos (id, path, created_at, last_accessed)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET last_accessed = ?`,
		[id, resolved, now, now, now],
	);

	return id;
}

/**
 * Look up a repo by its absolute path.
 * Hashes the path and returns the row, or null if not found.
 */
export async function getRepoByPath(
	db: SiaDb,
	path: string,
): Promise<Record<string, unknown> | null> {
	const resolved = resolve(path);
	const id = createHash("sha256").update(resolved).digest("hex");

	const result = await db.execute("SELECT * FROM repos WHERE id = ?", [id]);
	return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Workspace CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new workspace with the given name.
 * Generates a UUID v4 as the workspace id. Returns the id.
 */
export async function createWorkspace(db: SiaDb, name: string): Promise<string> {
	const id = randomUUID();
	const now = Date.now();

	await db.execute("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)", [
		id,
		name,
		now,
	]);

	return id;
}

/**
 * Resolve a workspace name to its UUID.
 * Returns the id if found, or null if no workspace with that name exists.
 */
export async function resolveWorkspaceName(db: SiaDb, name: string): Promise<string | null> {
	const result = await db.execute("SELECT id FROM workspaces WHERE name = ?", [name]);
	if (result.rows.length === 0) return null;
	return result.rows[0]?.id as string;
}

// ---------------------------------------------------------------------------
// Workspace-repo associations
// ---------------------------------------------------------------------------

/**
 * Add a repo to a workspace (workspace_repos join table).
 */
export async function addRepoToWorkspace(
	db: SiaDb,
	workspaceId: string,
	repoId: string,
): Promise<void> {
	await db.execute("INSERT INTO workspace_repos (workspace_id, repo_id) VALUES (?, ?)", [
		workspaceId,
		repoId,
	]);
}

/**
 * Remove a repo from a workspace.
 */
export async function removeRepoFromWorkspace(
	db: SiaDb,
	workspaceId: string,
	repoId: string,
): Promise<void> {
	await db.execute("DELETE FROM workspace_repos WHERE workspace_id = ? AND repo_id = ?", [
		workspaceId,
		repoId,
	]);
}

/**
 * Get all repos belonging to a workspace (joined with the repos table).
 */
export async function getWorkspaceRepos(
	db: SiaDb,
	workspaceId: string,
): Promise<Record<string, unknown>[]> {
	const result = await db.execute(
		`SELECT r.*, wr.role
		 FROM repos r
		 INNER JOIN workspace_repos wr ON wr.repo_id = r.id
		 WHERE wr.workspace_id = ?`,
		[workspaceId],
	);
	return result.rows;
}

// ---------------------------------------------------------------------------
// Sharing rules
// ---------------------------------------------------------------------------

/**
 * Get sharing rules for a workspace.
 * Returns rules that match the given workspace_id OR have a NULL workspace_id
 * (global rules that apply to all workspaces).
 */
export async function getSharingRules(
	db: SiaDb,
	workspaceId: string,
): Promise<Record<string, unknown>[]> {
	const result = await db.execute(
		"SELECT * FROM sharing_rules WHERE workspace_id = ? OR workspace_id IS NULL",
		[workspaceId],
	);
	return result.rows;
}
