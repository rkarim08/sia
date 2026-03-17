import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { addRepoToWorkspace, createWorkspace, openMetaDb, registerRepo } from "@/graph/meta-db";
import { openGraphDb } from "@/graph/semantic-db";
import { getPeerRepos } from "@/workspace/cross-repo";

describe("getPeerRepos", () => {
	let tmpDir: string;
	let metaDb: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-peers-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
		if (metaDb) {
			await metaDb.close();
			metaDb = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("returns peer repos for a workspace (excluding primary)", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);

		const wsId = await createWorkspace(metaDb, "peer-test-ws");
		const repoA = await registerRepo(metaDb, "/tmp/peer-repo-a");
		const repoB = await registerRepo(metaDb, "/tmp/peer-repo-b");

		await addRepoToWorkspace(metaDb, wsId, repoA);
		await addRepoToWorkspace(metaDb, wsId, repoB);

		// Create graph.db files so they're found
		const dbA = openGraphDb(repoA, tmpDir);
		await dbA.close();
		const dbB = openGraphDb(repoB, tmpDir);
		await dbB.close();

		const peers = await getPeerRepos(metaDb, wsId, repoA, tmpDir);
		expect(peers).toHaveLength(1);
		expect(peers[0].repoId).toBe(repoB);
	});

	it("returns empty when workspace has only one repo", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);

		const wsId = await createWorkspace(metaDb, "single-repo-ws");
		const repoA = await registerRepo(metaDb, "/tmp/single-repo");
		await addRepoToWorkspace(metaDb, wsId, repoA);

		const peers = await getPeerRepos(metaDb, wsId, repoA, tmpDir);
		expect(peers).toEqual([]);
	});

	it("skips peers without graph.db on disk", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);

		const wsId = await createWorkspace(metaDb, "missing-db-ws");
		const repoA = await registerRepo(metaDb, "/tmp/peer-missing-a");
		const repoB = await registerRepo(metaDb, "/tmp/peer-missing-b");

		await addRepoToWorkspace(metaDb, wsId, repoA);
		await addRepoToWorkspace(metaDb, wsId, repoB);

		// Only create graph.db for A, not B
		const dbA = openGraphDb(repoA, tmpDir);
		await dbA.close();

		const peers = await getPeerRepos(metaDb, wsId, repoA, tmpDir);
		// B is excluded because its graph.db doesn't exist
		expect(peers).toEqual([]);
	});
});
