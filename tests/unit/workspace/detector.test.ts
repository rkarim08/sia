import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openMetaDb, registerRepo } from "@/graph/meta-db";
import {
	detectMonorepoPackages,
	registerMonorepoPackages,
} from "@/workspace/detector";

describe("detector — monorepo auto-detection", () => {
	let tmpDir: string;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-detector-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// 1. pnpm-workspace.yaml detection
	// ---------------------------------------------------------------

	it("detects packages from pnpm-workspace.yaml", async () => {
		tmpDir = makeTmp();

		writeFileSync(
			join(tmpDir, "pnpm-workspace.yaml"),
			`packages:
  - 'packages/*'
  - tools/cli
`,
		);

		// Create subdirectories that match the globs
		mkdirSync(join(tmpDir, "packages", "core"), { recursive: true });
		mkdirSync(join(tmpDir, "packages", "utils"), { recursive: true });
		mkdirSync(join(tmpDir, "tools", "cli"), { recursive: true });

		const packages = await detectMonorepoPackages(tmpDir);
		expect(packages).toEqual(["packages/core", "packages/utils", "tools/cli"]);
	});

	// ---------------------------------------------------------------
	// 2. package.json workspaces array format
	// ---------------------------------------------------------------

	it("detects packages from package.json workspaces (array format)", async () => {
		tmpDir = makeTmp();

		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "my-monorepo",
				workspaces: ["packages/*"],
			}),
		);

		mkdirSync(join(tmpDir, "packages", "alpha"), { recursive: true });
		mkdirSync(join(tmpDir, "packages", "beta"), { recursive: true });

		const packages = await detectMonorepoPackages(tmpDir);
		expect(packages).toEqual(["packages/alpha", "packages/beta"]);
	});

	// ---------------------------------------------------------------
	// 3. package.json workspaces object format
	// ---------------------------------------------------------------

	it("detects packages from package.json workspaces (object format)", async () => {
		tmpDir = makeTmp();

		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "my-monorepo",
				workspaces: {
					packages: ["libs/*"],
					nohoist: ["**/react-native"],
				},
			}),
		);

		mkdirSync(join(tmpDir, "libs", "shared"), { recursive: true });
		mkdirSync(join(tmpDir, "libs", "ui"), { recursive: true });

		const packages = await detectMonorepoPackages(tmpDir);
		expect(packages).toEqual(["libs/shared", "libs/ui"]);
	});

	// ---------------------------------------------------------------
	// 4. Nx project.json detection
	// ---------------------------------------------------------------

	it("detects packages from Nx project.json files", async () => {
		tmpDir = makeTmp();

		writeFileSync(join(tmpDir, "nx.json"), JSON.stringify({ npmScope: "myorg" }));

		// Create subproject directories with project.json
		mkdirSync(join(tmpDir, "apps", "web"), { recursive: true });
		writeFileSync(join(tmpDir, "apps", "web", "project.json"), "{}");

		mkdirSync(join(tmpDir, "libs", "data"), { recursive: true });
		writeFileSync(join(tmpDir, "libs", "data", "project.json"), "{}");

		const packages = await detectMonorepoPackages(tmpDir);
		expect(packages).toEqual(["apps/web", "libs/data"]);
	});

	// ---------------------------------------------------------------
	// 5. Gradle settings.gradle detection
	// ---------------------------------------------------------------

	it("detects packages from settings.gradle", async () => {
		tmpDir = makeTmp();

		writeFileSync(
			join(tmpDir, "settings.gradle"),
			`rootProject.name = 'my-project'
include ':app'
include ':lib:core', ':lib:utils'
`,
		);

		const packages = await detectMonorepoPackages(tmpDir);
		expect(packages).toEqual(["app", "lib/core", "lib/utils"]);
	});

	// ---------------------------------------------------------------
	// 6. Gradle settings.gradle.kts detection
	// ---------------------------------------------------------------

	it("detects packages from settings.gradle.kts", async () => {
		tmpDir = makeTmp();

		writeFileSync(
			join(tmpDir, "settings.gradle.kts"),
			`rootProject.name = "my-project"
include(":app")
include(":feature:auth", ":feature:dashboard")
`,
		);

		const packages = await detectMonorepoPackages(tmpDir);
		expect(packages).toEqual(["app", "feature/auth", "feature/dashboard"]);
	});

	// ---------------------------------------------------------------
	// 7. turbo.json alone produces no packages
	// ---------------------------------------------------------------

	it("turbo.json alone produces no packages (informational only)", async () => {
		tmpDir = makeTmp();

		writeFileSync(
			join(tmpDir, "turbo.json"),
			JSON.stringify({ pipeline: { build: {} } }),
		);

		const packages = await detectMonorepoPackages(tmpDir);
		expect(packages).toEqual([]);
	});

	// ---------------------------------------------------------------
	// 8. turborepo + pnpm uses pnpm
	// ---------------------------------------------------------------

	it("turborepo + pnpm-workspace.yaml uses pnpm detection", async () => {
		tmpDir = makeTmp();

		writeFileSync(
			join(tmpDir, "turbo.json"),
			JSON.stringify({ pipeline: { build: {} } }),
		);

		writeFileSync(
			join(tmpDir, "pnpm-workspace.yaml"),
			`packages:
  - 'apps/*'
`,
		);

		mkdirSync(join(tmpDir, "apps", "web"), { recursive: true });
		mkdirSync(join(tmpDir, "apps", "api"), { recursive: true });

		const packages = await detectMonorepoPackages(tmpDir);
		expect(packages).toEqual(["apps/api", "apps/web"]);
	});

	// ---------------------------------------------------------------
	// 9. standalone repo returns empty
	// ---------------------------------------------------------------

	it("standalone repo with no monorepo markers returns empty array", async () => {
		tmpDir = makeTmp();

		// Just a plain package.json with no workspaces
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "my-app", version: "1.0.0" }),
		);

		const packages = await detectMonorepoPackages(tmpDir);
		expect(packages).toEqual([]);
	});

	// ---------------------------------------------------------------
	// 10. pnpm takes precedence over package.json
	// ---------------------------------------------------------------

	it("pnpm-workspace.yaml takes precedence over package.json workspaces", async () => {
		tmpDir = makeTmp();

		// Both pnpm-workspace.yaml and package.json with workspaces exist
		writeFileSync(
			join(tmpDir, "pnpm-workspace.yaml"),
			`packages:
  - 'pnpm-packages/*'
`,
		);

		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "my-monorepo",
				workspaces: ["npm-packages/*"],
			}),
		);

		mkdirSync(join(tmpDir, "pnpm-packages", "a"), { recursive: true });
		mkdirSync(join(tmpDir, "npm-packages", "b"), { recursive: true });

		const packages = await detectMonorepoPackages(tmpDir);
		// Should use pnpm paths, not npm paths
		expect(packages).toEqual(["pnpm-packages/a"]);
	});
});

// ===================================================================
// registerMonorepoPackages tests
// ===================================================================

describe("detector — registerMonorepoPackages", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-detector-reg-test-${randomUUID()}`);
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
	// 11. registerMonorepoPackages writes correct types
	// ---------------------------------------------------------------

	it("registerMonorepoPackages marks root and inserts packages", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const rootPath = "/tmp/my-monorepo";
		const rootRepoId = await registerRepo(db, rootPath);

		await registerMonorepoPackages(db, rootRepoId, rootPath, [
			"packages/core",
			"packages/utils",
		]);

		// Root repo should be marked as monorepo_root
		const rootResult = await db.execute("SELECT * FROM repos WHERE id = ?", [rootRepoId]);
		expect(rootResult.rows).toHaveLength(1);
		expect(rootResult.rows[0]?.detected_type).toBe("monorepo_root");

		// Each package should be registered as monorepo_package
		const pkgsResult = await db.execute(
			"SELECT * FROM repos WHERE monorepo_root_id = ? ORDER BY name",
			[rootRepoId],
		);
		expect(pkgsResult.rows).toHaveLength(2);

		expect(pkgsResult.rows[0]?.name).toBe("packages/core");
		expect(pkgsResult.rows[0]?.detected_type).toBe("monorepo_package");
		expect(pkgsResult.rows[0]?.monorepo_root_id).toBe(rootRepoId);

		expect(pkgsResult.rows[1]?.name).toBe("packages/utils");
		expect(pkgsResult.rows[1]?.detected_type).toBe("monorepo_package");
		expect(pkgsResult.rows[1]?.monorepo_root_id).toBe(rootRepoId);

		// Verify the package path is the resolved full path
		const expectedPath = resolve(rootPath, "packages/core");
		expect(pkgsResult.rows[0]?.path).toBe(expectedPath);

		// Verify the package id is sha256 of the full resolved path
		const expectedId = createHash("sha256").update(expectedPath).digest("hex");
		expect(pkgsResult.rows[0]?.id).toBe(expectedId);
	});

	// ---------------------------------------------------------------
	// 12. registerMonorepoPackages is idempotent
	// ---------------------------------------------------------------

	it("registerMonorepoPackages is idempotent", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const rootPath = "/tmp/idempotent-monorepo";
		const rootRepoId = await registerRepo(db, rootPath);

		const packagePaths = ["libs/shared"];

		// Register twice
		await registerMonorepoPackages(db, rootRepoId, rootPath, packagePaths);
		await registerMonorepoPackages(db, rootRepoId, rootPath, packagePaths);

		// Root should still be monorepo_root
		const rootResult = await db.execute("SELECT * FROM repos WHERE id = ?", [rootRepoId]);
		expect(rootResult.rows).toHaveLength(1);
		expect(rootResult.rows[0]?.detected_type).toBe("monorepo_root");

		// Should have exactly one package, not two
		const pkgsResult = await db.execute(
			"SELECT * FROM repos WHERE monorepo_root_id = ?",
			[rootRepoId],
		);
		expect(pkgsResult.rows).toHaveLength(1);
		expect(pkgsResult.rows[0]?.name).toBe("libs/shared");
		expect(pkgsResult.rows[0]?.detected_type).toBe("monorepo_package");
	});
});
