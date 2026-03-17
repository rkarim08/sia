import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openMetaDb, registerRepo } from "@/graph/meta-db";
import { parseManifest, type SiaManifest, writeManifestContracts } from "@/workspace/manifest";

describe("manifest — .sia-manifest.yaml parser and contract writer", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-manifest-test-${randomUUID()}`);
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

	// -------------------------------------------------------------------
	// parseManifest
	// -------------------------------------------------------------------

	it("parses valid manifest with provides, consumes, depends_on", () => {
		const yaml = `
provides:
  - type: openapi
    path: openapi.yaml
  - type: graphql
    path: schema.graphql
consumes:
  - type: npm-package
    package: "@acme/shared"
depends_on:
  - type: ts-reference
    path: ../shared/tsconfig.json
`;

		const manifest = parseManifest(yaml);
		expect(manifest).not.toBeNull();

		expect(manifest?.provides).toHaveLength(2);
		expect(manifest?.provides[0]).toEqual({
			type: "openapi",
			path: "openapi.yaml",
			package: undefined,
		});
		expect(manifest?.provides[1]).toEqual({
			type: "graphql",
			path: "schema.graphql",
			package: undefined,
		});

		expect(manifest?.consumes).toHaveLength(1);
		expect(manifest?.consumes[0]).toEqual({
			type: "npm-package",
			path: undefined,
			package: "@acme/shared",
		});

		expect(manifest?.depends_on).toHaveLength(1);
		expect(manifest?.depends_on[0]).toEqual({
			type: "ts-reference",
			path: "../shared/tsconfig.json",
			package: undefined,
		});
	});

	it("returns null for malformed YAML and warns", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = parseManifest(":\n  :\n    - ][invalid");
		expect(result).toBeNull();
		expect(warnSpy).toHaveBeenCalledOnce();
		expect(warnSpy.mock.calls[0]?.[0]).toContain("malformed YAML");

		warnSpy.mockRestore();
	});

	it("returns empty arrays for empty manifest", () => {
		const manifest = parseManifest("");
		expect(manifest).not.toBeNull();
		expect(manifest?.provides).toEqual([]);
		expect(manifest?.consumes).toEqual([]);
		expect(manifest?.depends_on).toEqual([]);
	});

	it("returns empty arrays for manifest with only unrecognized keys", () => {
		const manifest = parseManifest("foo: bar\nbaz: 42");
		expect(manifest).not.toBeNull();
		expect(manifest?.provides).toEqual([]);
		expect(manifest?.consumes).toEqual([]);
		expect(manifest?.depends_on).toEqual([]);
	});

	it("filters out items missing the type field", () => {
		const yaml = `
provides:
  - type: openapi
    path: openapi.yaml
  - path: no-type-here.yaml
  - type: graphql
`;

		const manifest = parseManifest(yaml);
		expect(manifest).not.toBeNull();
		expect(manifest?.provides).toHaveLength(2);
		expect(manifest?.provides[0]?.type).toBe("openapi");
		expect(manifest?.provides[1]?.type).toBe("graphql");
	});

	it("supports all 11 contract types", () => {
		const contractTypes = [
			"openapi",
			"graphql",
			"trpc",
			"grpc",
			"npm-package",
			"ts-reference",
			"csproj-reference",
			"cargo-dependency",
			"go-mod-replace",
			"python-path-dep",
			"gradle-project",
		];

		const entries = contractTypes.map((t) => `  - type: ${t}`).join("\n");
		const yaml = `provides:\n${entries}`;

		const manifest = parseManifest(yaml);
		expect(manifest).not.toBeNull();
		expect(manifest?.provides).toHaveLength(11);

		const parsedTypes = manifest?.provides.map((c) => c.type);
		expect(parsedTypes).toEqual(contractTypes);
	});

	// -------------------------------------------------------------------
	// writeManifestContracts
	// -------------------------------------------------------------------

	it("writes manifest contracts to meta.db with trust_tier 1", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const providerRepoId = await registerRepo(db, "/tmp/provider-repo");
		const consumerRepoId = await registerRepo(db, "/tmp/consumer-repo");

		const manifest: SiaManifest = {
			provides: [{ type: "openapi", path: "openapi.yaml" }],
			consumes: [{ type: "npm-package", package: "@acme/shared" }],
			depends_on: [{ type: "ts-reference", path: "../shared/tsconfig.json" }],
		};

		await writeManifestContracts(db, providerRepoId, consumerRepoId, manifest);

		const result = await db.execute("SELECT * FROM api_contracts ORDER BY contract_type");
		expect(result.rows).toHaveLength(3);

		// All contracts should have trust_tier = 1 (manifest-declared)
		for (const row of result.rows) {
			expect(row.trust_tier).toBe(1);
			expect(row.detected_at).toBeTypeOf("number");
			expect(row.id).toBeTypeOf("string");
		}

		// provides: provider -> consumer, type=openapi, spec_path=openapi.yaml
		const openapi = result.rows.find((r) => r.contract_type === "openapi");
		expect(openapi).toBeDefined();
		expect(openapi?.provider_repo_id).toBe(providerRepoId);
		expect(openapi?.consumer_repo_id).toBe(consumerRepoId);
		expect(openapi?.spec_path).toBe("openapi.yaml");

		// consumes: consumer -> provider (reversed), type=npm-package, spec_path from package
		const npm = result.rows.find((r) => r.contract_type === "npm-package");
		expect(npm).toBeDefined();
		expect(npm?.provider_repo_id).toBe(consumerRepoId);
		expect(npm?.consumer_repo_id).toBe(providerRepoId);
		expect(npm?.spec_path).toBe("@acme/shared");

		// depends_on: consumer -> provider (reversed), type=ts-reference
		const tsRef = result.rows.find((r) => r.contract_type === "ts-reference");
		expect(tsRef).toBeDefined();
		expect(tsRef?.provider_repo_id).toBe(consumerRepoId);
		expect(tsRef?.consumer_repo_id).toBe(providerRepoId);
		expect(tsRef?.spec_path).toBe("../shared/tsconfig.json");
	});

	it("contracts are idempotent on re-write", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const providerRepoId = await registerRepo(db, "/tmp/idempotent-provider");
		const consumerRepoId = await registerRepo(db, "/tmp/idempotent-consumer");

		const manifest: SiaManifest = {
			provides: [{ type: "openapi", path: "v1/openapi.yaml" }],
			consumes: [],
			depends_on: [],
		};

		// Write once
		await writeManifestContracts(db, providerRepoId, consumerRepoId, manifest);

		const first = await db.execute("SELECT * FROM api_contracts");
		expect(first.rows).toHaveLength(1);
		const firstId = first.rows[0]?.id;
		const firstDetectedAt = first.rows[0]?.detected_at;

		// Write again (with updated path)
		const manifest2: SiaManifest = {
			provides: [{ type: "openapi", path: "v2/openapi.yaml" }],
			consumes: [],
			depends_on: [],
		};

		await writeManifestContracts(db, providerRepoId, consumerRepoId, manifest2);

		const second = await db.execute("SELECT * FROM api_contracts");
		// Still only 1 row (upserted, not duplicated)
		expect(second.rows).toHaveLength(1);
		// Same id preserved
		expect(second.rows[0]?.id).toBe(firstId);
		// spec_path updated
		expect(second.rows[0]?.spec_path).toBe("v2/openapi.yaml");
		// detected_at updated
		expect(second.rows[0]?.detected_at).toBeGreaterThanOrEqual(firstDetectedAt as number);
	});

	it("writes nothing for empty manifest", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const providerRepoId = await registerRepo(db, "/tmp/empty-provider");
		const consumerRepoId = await registerRepo(db, "/tmp/empty-consumer");

		const manifest: SiaManifest = {
			provides: [],
			consumes: [],
			depends_on: [],
		};

		await writeManifestContracts(db, providerRepoId, consumerRepoId, manifest);

		const result = await db.execute("SELECT * FROM api_contracts");
		expect(result.rows).toHaveLength(0);
	});
});
