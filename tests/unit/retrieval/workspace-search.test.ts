import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openBridgeDb } from "@/graph/bridge-db";
import type { SiaDb } from "@/graph/db-interface";
import { addRepoToWorkspace, createWorkspace, openMetaDb, registerRepo } from "@/graph/meta-db";
import { openGraphDb } from "@/graph/semantic-db";
import { workspaceSearch } from "@/retrieval/workspace-search";

describe("workspace-search", () => {
	let tmpDir: string;
	let metaDb: SiaDb | undefined;
	let primaryDb: SiaDb | undefined;
	let peerDb: SiaDb | undefined;
	let bridgeDb: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-ws-search-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	async function insertEntity(db: SiaDb, name: string, importance = 0.5): Promise<string> {
		const id = randomUUID();
		const now = Date.now();
		await db.execute(
			`INSERT INTO entities (
				id, type, name, content, summary,
				package_path, tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance,
				access_count, edge_count,
				last_accessed, created_at,
				t_created, t_expired, t_valid_from, t_valid_until,
				visibility, created_by
			) VALUES (
				?, 'Concept', ?, 'content', 'summary',
				NULL, '[]', '["src/foo.ts"]',
				2, 0.8, 0.8,
				?, 0.5,
				0, 0,
				?, ?,
				?, NULL, NULL, NULL,
				'private', 'dev-1'
			)`,
			[id, name, importance, now, now, now],
		);
		return id;
	}

	afterEach(async () => {
		if (primaryDb) {
			await primaryDb.close();
			primaryDb = undefined;
		}
		if (peerDb) {
			await peerDb.close();
			peerDb = undefined;
		}
		if (metaDb) {
			await metaDb.close();
			metaDb = undefined;
		}
		if (bridgeDb) {
			await bridgeDb.close();
			bridgeDb = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("returns entities from primary and peer repos", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);
		bridgeDb = openBridgeDb(tmpDir);

		const repoAId = await registerRepo(metaDb, "/tmp/ws-search-a");
		const repoBId = await registerRepo(metaDb, "/tmp/ws-search-b");

		const wsId = await createWorkspace(metaDb, "search-ws");
		await addRepoToWorkspace(metaDb, wsId, repoAId);
		await addRepoToWorkspace(metaDb, wsId, repoBId);

		primaryDb = openGraphDb(repoAId, tmpDir);
		peerDb = openGraphDb(repoBId, tmpDir);

		await insertEntity(primaryDb, "Entity From A", 0.9);
		await insertEntity(peerDb, "Entity From B", 0.8);

		// Close peer before search (search opens via ATTACH)
		await peerDb.close();
		peerDb = undefined;

		const results = await workspaceSearch({
			primaryDb,
			metaDb,
			bridgeDb,
			workspaceId: wsId,
			primaryRepoId: repoAId,
			query: "entity",
			siaHome: tmpDir,
		});

		expect(results.entities.length).toBeGreaterThanOrEqual(2);
		const names = results.entities.map((e) => e.name);
		expect(names).toContain("Entity From A");
		expect(names).toContain("Entity From B");

		// source_repo_name should be null for primary, non-null for peers
		const entityA = results.entities.find((e) => e.name === "Entity From A");
		expect(entityA?.source_repo_name).toBeNull();
		const entityB = results.entities.find((e) => e.name === "Entity From B");
		expect(entityB?.source_repo_name).not.toBeNull();
	});

	it("includes missing_repos for peer with no graph.db", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);
		bridgeDb = openBridgeDb(tmpDir);

		const repoAId = await registerRepo(metaDb, "/tmp/ws-search-missing-a");
		const repoBId = await registerRepo(metaDb, "/tmp/ws-search-missing-b");

		const wsId = await createWorkspace(metaDb, "missing-ws");
		await addRepoToWorkspace(metaDb, wsId, repoAId);
		await addRepoToWorkspace(metaDb, wsId, repoBId);

		primaryDb = openGraphDb(repoAId, tmpDir);
		await insertEntity(primaryDb, "Only In A");
		// Don't create graph.db for repo B

		const results = await workspaceSearch({
			primaryDb,
			metaDb,
			bridgeDb,
			workspaceId: wsId,
			primaryRepoId: repoAId,
			query: "only",
			siaHome: tmpDir,
		});

		expect(results.entities).toHaveLength(1);
		// B doesn't even show up in peers (getPeerRepos filters by disk existence)
		expect(results.missingRepos).toHaveLength(0);
	});

	it("results sorted by importance DESC", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);
		bridgeDb = openBridgeDb(tmpDir);

		const repoAId = await registerRepo(metaDb, "/tmp/ws-sort-a");
		const repoBId = await registerRepo(metaDb, "/tmp/ws-sort-b");

		const wsId = await createWorkspace(metaDb, "sort-ws");
		await addRepoToWorkspace(metaDb, wsId, repoAId);
		await addRepoToWorkspace(metaDb, wsId, repoBId);

		primaryDb = openGraphDb(repoAId, tmpDir);
		peerDb = openGraphDb(repoBId, tmpDir);

		await insertEntity(primaryDb, "Low", 0.2);
		await insertEntity(peerDb, "High", 0.9);
		await insertEntity(primaryDb, "Mid", 0.5);

		await peerDb.close();
		peerDb = undefined;

		const results = await workspaceSearch({
			primaryDb,
			metaDb,
			bridgeDb,
			workspaceId: wsId,
			primaryRepoId: repoAId,
			query: "test",
			siaHome: tmpDir,
		});

		expect(results.entities).toHaveLength(3);
		expect(results.entities[0].name).toBe("High");
		expect(results.entities[1].name).toBe("Mid");
		expect(results.entities[2].name).toBe("Low");
	});

	it("respects limit parameter", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);
		bridgeDb = openBridgeDb(tmpDir);

		const repoAId = await registerRepo(metaDb, "/tmp/ws-limit-a");
		const wsId = await createWorkspace(metaDb, "limit-ws");
		await addRepoToWorkspace(metaDb, wsId, repoAId);

		primaryDb = openGraphDb(repoAId, tmpDir);
		for (let i = 0; i < 10; i++) {
			await insertEntity(primaryDb, `Entity ${i}`, 0.5 + i * 0.01);
		}

		const results = await workspaceSearch({
			primaryDb,
			metaDb,
			bridgeDb,
			workspaceId: wsId,
			primaryRepoId: repoAId,
			query: "test",
			siaHome: tmpDir,
			limit: 3,
		});

		expect(results.entities).toHaveLength(3);
	});
});
