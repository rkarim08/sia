import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import {
	addRepoToWorkspace,
	createWorkspace,
	getRepoByPath,
	getSharingRules,
	getWorkspaceRepos,
	listWorkspaces,
	openMetaDb,
	registerRepo,
	removeRepoFromWorkspace,
	resolveWorkspaceName,
} from "@/graph/meta-db";

describe("meta-db CRUD (workspace and repo registry)", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-meta-crud-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// registerRepo
	// ---------------------------------------------------------------

	it("registerRepo creates repo entry and returns hash", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const testPath = "/tmp/test-repo";
		const id = await registerRepo(db, testPath);

		// Verify the id is the SHA-256 hash of the resolved path.
		const expectedId = createHash("sha256").update(resolve(testPath)).digest("hex");
		expect(id).toBe(expectedId);

		// Verify the row exists in the database.
		const result = await db.execute("SELECT * FROM repos WHERE id = ?", [id]);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.path).toBe(resolve(testPath));
		expect(result.rows[0]?.created_at).toBeTypeOf("number");
	});

	it("registerRepo same path twice is idempotent", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const testPath = "/tmp/idempotent-repo";
		const id1 = await registerRepo(db, testPath);
		const id2 = await registerRepo(db, testPath);

		// Same id returned both times.
		expect(id1).toBe(id2);

		// Only one row in the table.
		const result = await db.execute("SELECT * FROM repos WHERE id = ?", [id1]);
		expect(result.rows).toHaveLength(1);

		// last_accessed was updated (non-null).
		expect(result.rows[0]?.last_accessed).toBeTypeOf("number");
	});

	// ---------------------------------------------------------------
	// getRepoByPath
	// ---------------------------------------------------------------

	it("getRepoByPath returns the repo for a registered path", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const testPath = "/tmp/repo-by-path";
		const id = await registerRepo(db, testPath);

		const repo = await getRepoByPath(db, testPath);
		expect(repo).not.toBeNull();
		expect(repo?.id).toBe(id);
		expect(repo?.path).toBe(resolve(testPath));
	});

	it("getRepoByPath returns null for unregistered path", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const repo = await getRepoByPath(db, "/tmp/nonexistent-repo");
		expect(repo).toBeNull();
	});

	// ---------------------------------------------------------------
	// createWorkspace + resolveWorkspaceName round-trip
	// ---------------------------------------------------------------

	it("createWorkspace + resolveWorkspaceName round-trip", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const wsName = "my-workspace";
		const wsId = await createWorkspace(db, wsName);

		expect(wsId).toBeTypeOf("string");
		expect(wsId.length).toBeGreaterThan(0);

		const resolvedId = await resolveWorkspaceName(db, wsName);
		expect(resolvedId).toBe(wsId);
	});

	it("resolveWorkspaceName returns null for unknown name", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const result = await resolveWorkspaceName(db, "does-not-exist");
		expect(result).toBeNull();
	});

	// ---------------------------------------------------------------
	// addRepoToWorkspace + getWorkspaceRepos round-trip
	// ---------------------------------------------------------------

	it("addRepoToWorkspace + getWorkspaceRepos round-trip", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		// Create a workspace and register two repos.
		const wsId = await createWorkspace(db, "ws-repos-test");
		const repoId1 = await registerRepo(db, "/tmp/repo-a");
		const repoId2 = await registerRepo(db, "/tmp/repo-b");

		await addRepoToWorkspace(db, wsId, repoId1);
		await addRepoToWorkspace(db, wsId, repoId2);

		const repos = await getWorkspaceRepos(db, wsId);
		expect(repos).toHaveLength(2);

		const ids = repos.map((r) => r.id as string).sort();
		expect(ids).toEqual([repoId1, repoId2].sort());

		// Each row should include the role from workspace_repos.
		for (const repo of repos) {
			expect(repo.role).toBe("member");
		}
	});

	// ---------------------------------------------------------------
	// removeRepoFromWorkspace
	// ---------------------------------------------------------------

	it("removeRepoFromWorkspace removes the link", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const wsId = await createWorkspace(db, "ws-remove-test");
		const repoId = await registerRepo(db, "/tmp/repo-remove");

		await addRepoToWorkspace(db, wsId, repoId);

		// Verify it was added.
		let repos = await getWorkspaceRepos(db, wsId);
		expect(repos).toHaveLength(1);

		// Remove and verify.
		await removeRepoFromWorkspace(db, wsId, repoId);
		repos = await getWorkspaceRepos(db, wsId);
		expect(repos).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// getSharingRules
	// ---------------------------------------------------------------

	it("getSharingRules returns matching rules", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const wsId = await createWorkspace(db, "ws-sharing-test");

		// Insert a workspace-specific rule.
		await db.execute(
			"INSERT INTO sharing_rules (id, workspace_id, entity_type, default_visibility, created_at) VALUES (?, ?, ?, ?, ?)",
			["rule-ws", wsId, "Decision", "team", Date.now()],
		);

		// Insert a global rule (workspace_id IS NULL).
		await db.execute(
			"INSERT INTO sharing_rules (id, workspace_id, entity_type, default_visibility, created_at) VALUES (?, ?, ?, ?, ?)",
			["rule-global", null, null, "private", Date.now()],
		);

		// Insert a rule for a different workspace (should NOT be returned).
		const otherWsId = await createWorkspace(db, "ws-other");
		await db.execute(
			"INSERT INTO sharing_rules (id, workspace_id, entity_type, default_visibility, created_at) VALUES (?, ?, ?, ?, ?)",
			["rule-other", otherWsId, "Bug", "project", Date.now()],
		);

		const rules = await getSharingRules(db, wsId);
		expect(rules).toHaveLength(2);

		const ruleIds = rules.map((r) => r.id as string).sort();
		expect(ruleIds).toEqual(["rule-global", "rule-ws"]);
	});

	// ---------------------------------------------------------------
	// listWorkspaces
	// ---------------------------------------------------------------

	it("listWorkspaces returns all workspaces with member counts", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const ws1 = await createWorkspace(db, "workspace-one");
		const _ws2 = await createWorkspace(db, "workspace-two");

		const repoId = await registerRepo(db, "/tmp/list-ws-repo");
		await addRepoToWorkspace(db, ws1, repoId);

		const list = await listWorkspaces(db);
		expect(list).toHaveLength(2);

		const ws1Entry = list.find((w) => w.name === "workspace-one");
		expect(ws1Entry?.member_count).toBe(1);

		const ws2Entry = list.find((w) => w.name === "workspace-two");
		expect(ws2Entry?.member_count).toBe(0);
	});
});
