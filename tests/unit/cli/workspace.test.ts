import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openBridgeDb } from "@/graph/bridge-db";
import { openMetaDb } from "@/graph/meta-db";
import {
	workspaceAdd,
	workspaceCreate,
	workspaceList,
	workspaceRemove,
	workspaceShow,
} from "@/cli/commands/workspace";

describe("workspace CLI commands", () => {
	let tmpDir: string;
	let metaDb: SiaDb | undefined;
	let bridgeDb: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-ws-cli-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
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

	// ---------------------------------------------------------------
	// create + list round-trip
	// ---------------------------------------------------------------

	it("create + list round-trip", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);

		await workspaceCreate(metaDb, "my-project");
		const list = await workspaceList(metaDb);

		expect(list).toHaveLength(1);
		expect(list[0].name).toBe("my-project");
		expect(list[0].member_count).toBe(0);
	});

	// ---------------------------------------------------------------
	// add + show round-trip
	// ---------------------------------------------------------------

	it("add + show round-trip", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);
		bridgeDb = openBridgeDb(tmpDir);

		// Create a fake repo with an openapi.yaml
		const repoDir = join(tmpDir, "fake-repo");
		mkdirSync(repoDir);
		writeFileSync(join(repoDir, "openapi.yaml"), "openapi: 3.0.0");

		await workspaceCreate(metaDb, "ws-add-show");
		await workspaceAdd(metaDb, "ws-add-show", repoDir);

		const info = await workspaceShow(metaDb, bridgeDb, "ws-add-show");
		expect(info.members).toHaveLength(1);
		expect(info.contractCount).toBeGreaterThanOrEqual(1);
		expect(info.crossRepoEdgeCount).toBe(0);
	});

	// ---------------------------------------------------------------
	// remove removes the link
	// ---------------------------------------------------------------

	it("remove removes the link", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);

		const repoDir = join(tmpDir, "remove-repo");
		mkdirSync(repoDir);

		await workspaceCreate(metaDb, "ws-remove");
		await workspaceAdd(metaDb, "ws-remove", repoDir);

		let list = await workspaceList(metaDb);
		expect(list[0].member_count).toBe(1);

		await workspaceRemove(metaDb, "ws-remove", repoDir);
		list = await workspaceList(metaDb);
		expect(list[0].member_count).toBe(0);
	});

	// ---------------------------------------------------------------
	// create with duplicate name throws
	// ---------------------------------------------------------------

	it("create with duplicate name throws", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);

		await workspaceCreate(metaDb, "dup-ws");
		await expect(workspaceCreate(metaDb, "dup-ws")).rejects.toThrow();
	});

	// ---------------------------------------------------------------
	// add to nonexistent workspace throws
	// ---------------------------------------------------------------

	it("add to nonexistent workspace throws", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);

		await expect(workspaceAdd(metaDb, "nonexistent", "/tmp/some-path")).rejects.toThrow(
			/not found/i,
		);
	});

	// ---------------------------------------------------------------
	// show on nonexistent workspace throws
	// ---------------------------------------------------------------

	it("show on nonexistent workspace throws", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);
		bridgeDb = openBridgeDb(tmpDir);

		await expect(workspaceShow(metaDb, bridgeDb, "nope")).rejects.toThrow(/not found/i);
	});

	// ---------------------------------------------------------------
	// multiple workspaces listed correctly
	// ---------------------------------------------------------------

	it("multiple workspaces listed with correct counts", async () => {
		tmpDir = makeTmp();
		metaDb = openMetaDb(tmpDir);

		await workspaceCreate(metaDb, "alpha");
		await workspaceCreate(metaDb, "beta");

		const repoDir = join(tmpDir, "repo-for-alpha");
		mkdirSync(repoDir);

		await workspaceAdd(metaDb, "alpha", repoDir);

		const list = await workspaceList(metaDb);
		expect(list).toHaveLength(2);

		const alpha = list.find((w) => w.name === "alpha");
		expect(alpha?.member_count).toBe(1);

		const beta = list.find((w) => w.name === "beta");
		expect(beta?.member_count).toBe(0);
	});
});
