// Module: reindex — unit tests for the reindex command (Task 14.12 backfill)

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock heavyweight modules before importing the command under test.
vi.mock("@/ast/indexer", () => ({
	indexRepository: vi.fn().mockResolvedValue({
		filesProcessed: 0,
		entitiesCreated: 0,
		cacheHits: 0,
		durationMs: 0,
	}),
}));
vi.mock("@/workspace/detector", () => ({
	detectMonorepoPackages: vi.fn().mockResolvedValue([]),
	registerMonorepoPackages: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/workspace/api-contracts", () => ({
	detectApiContracts: vi.fn().mockResolvedValue([]),
	writeDetectedContracts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/graph/meta-db", () => ({
	openMetaDb: vi.fn().mockReturnValue({
		close: vi.fn().mockResolvedValue(undefined),
	}),
	registerRepo: vi.fn().mockResolvedValue("repo-id"),
}));

import { siaReindex } from "@/cli/commands/reindex";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmpRepo(): string {
	const dir = join(tmpdir(), `sia-reindex-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	// siaReindex requires a .git directory to identify a repo root.
	mkdirSync(join(dir, ".git"), { recursive: true });
	return dir;
}

function toPosix(p: string | null): string | null {
	return p === null ? null : p.split(sep).join("/");
}

describe("siaReindex — package_path backfill (Task 14.12)", () => {
	let repoRoot: string;
	let siaHome: string;

	beforeEach(() => {
		repoRoot = makeTmpRepo();
		siaHome = join(tmpdir(), `sia-home-${randomUUID()}`);
		mkdirSync(siaHome, { recursive: true });
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
		rmSync(siaHome, { recursive: true, force: true });
	});

	it("backfills package_path for entities whose file_paths resolve to a package", async () => {
		// Create a monorepo layout: packages/core/package.json + packages/utils/package.json.
		const coreDir = join(repoRoot, "packages", "core");
		const utilsDir = join(repoRoot, "packages", "utils");
		mkdirSync(join(coreDir, "src"), { recursive: true });
		mkdirSync(join(utilsDir, "src"), { recursive: true });
		writeFileSync(join(coreDir, "package.json"), JSON.stringify({ name: "core" }));
		writeFileSync(join(utilsDir, "package.json"), JSON.stringify({ name: "utils" }));

		// Compute the per-repo graph db path (siaReindex derives it from repoHash).
		// Insert fixture entities via openGraphDb directly using the SAME repo root.
		// siaReindex hashes resolve(repoRoot); we do the same by calling openGraphDb through
		// the public API below after invoking siaReindex once (it creates the DB).
		//
		// We seed first by computing the hash the way reindex does:
		const { createHash } = await import("node:crypto");
		const { resolve } = await import("node:path");
		const repoHash = createHash("sha256").update(resolve(repoRoot)).digest("hex");

		const db = openGraphDb(repoHash, siaHome);

		// Entity A: file inside packages/core — should be backfilled to "packages/core".
		const entityA = await insertEntity(db, {
			type: "CodeEntity",
			name: "a-entity",
			content: "core logic",
			summary: "core",
			file_paths: JSON.stringify(["packages/core/src/a.ts"]),
		});
		// Entity B: file inside packages/utils — should be backfilled to "packages/utils".
		const entityB = await insertEntity(db, {
			type: "CodeEntity",
			name: "b-entity",
			content: "util logic",
			summary: "utils",
			file_paths: JSON.stringify(["packages/utils/src/b.ts"]),
		});
		// Entity C: file outside any package — no backfill (no package.json above it).
		const entityC = await insertEntity(db, {
			type: "CodeEntity",
			name: "c-entity",
			content: "loose",
			summary: "loose",
			file_paths: JSON.stringify(["misc/c.ts"]),
		});

		// Confirm all three start with NULL package_path.
		for (const id of [entityA.id, entityB.id, entityC.id]) {
			const { rows } = await db.execute(
				"SELECT package_path FROM graph_nodes WHERE id = ?",
				[id],
			);
			expect(rows[0]?.package_path).toBeNull();
		}

		await db.close();

		// Run reindex — the indexer is mocked out, so only the backfill pass runs.
		const result = await siaReindex({ cwd: repoRoot, siaHome });

		expect(result.packagePathBackfilled).toBe(2);

		// Reopen and verify.
		const dbAfter = openGraphDb(repoHash, siaHome);
		try {
			const { rows: rowsA } = await dbAfter.execute(
				"SELECT package_path FROM graph_nodes WHERE id = ?",
				[entityA.id],
			);
			expect(toPosix(rowsA[0]?.package_path as string | null)).toBe("packages/core");

			const { rows: rowsB } = await dbAfter.execute(
				"SELECT package_path FROM graph_nodes WHERE id = ?",
				[entityB.id],
			);
			expect(toPosix(rowsB[0]?.package_path as string | null)).toBe("packages/utils");

			// Entity C has no package.json above it; inferPackagePath returns "" which the
			// backfill pass skips (only non-empty results are written).
			const { rows: rowsC } = await dbAfter.execute(
				"SELECT package_path FROM graph_nodes WHERE id = ?",
				[entityC.id],
			);
			expect(rowsC[0]?.package_path).toBeNull();
		} finally {
			await dbAfter.close();
		}
	});
});
