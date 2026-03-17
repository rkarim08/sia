import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectApiContracts } from "@/workspace/api-contracts";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-api-contracts-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("detectApiContracts", () => {
	let tmpDir: string;

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// OpenAPI / Swagger
	// ---------------------------------------------------------------

	it("detects openapi.yaml", async () => {
		tmpDir = makeTmp();
		writeFileSync(join(tmpDir, "openapi.yaml"), "openapi: 3.0.0");

		const contracts = await detectApiContracts(tmpDir);

		expect(contracts).toHaveLength(1);
		expect(contracts[0]).toEqual({ type: "openapi", specPath: "openapi.yaml" });
	});

	it("detects swagger.json", async () => {
		tmpDir = makeTmp();
		writeFileSync(join(tmpDir, "swagger.json"), '{ "swagger": "2.0" }');

		const contracts = await detectApiContracts(tmpDir);

		expect(contracts).toHaveLength(1);
		expect(contracts[0]).toEqual({ type: "openapi", specPath: "swagger.json" });
	});

	// ---------------------------------------------------------------
	// GraphQL
	// ---------------------------------------------------------------

	it("detects root-level .graphql files", async () => {
		tmpDir = makeTmp();
		writeFileSync(join(tmpDir, "schema.graphql"), "type Query { hello: String }");

		const contracts = await detectApiContracts(tmpDir);

		expect(contracts).toHaveLength(1);
		expect(contracts[0]).toEqual({ type: "graphql", specPath: "schema.graphql" });
	});

	it("detects nested .graphql files recursively", async () => {
		tmpDir = makeTmp();
		const subDir = join(tmpDir, "src", "graphql");
		mkdirSync(subDir, { recursive: true });
		writeFileSync(join(subDir, "queries.graphql"), "type Query { users: [User] }");

		const contracts = await detectApiContracts(tmpDir);

		expect(contracts).toHaveLength(1);
		expect(contracts[0]).toEqual({
			type: "graphql",
			specPath: join("src", "graphql", "queries.graphql"),
		});
	});

	// ---------------------------------------------------------------
	// TypeScript project references
	// ---------------------------------------------------------------

	it("detects tsconfig project references", async () => {
		tmpDir = makeTmp();
		const tsconfig = {
			references: [{ path: "../shared" }, { path: "../core" }],
		};
		writeFileSync(join(tmpDir, "tsconfig.json"), JSON.stringify(tsconfig));

		const contracts = await detectApiContracts(tmpDir);

		expect(contracts).toHaveLength(2);
		expect(contracts[0]).toEqual({ type: "ts-reference", specPath: "../shared" });
		expect(contracts[1]).toEqual({ type: "ts-reference", specPath: "../core" });
	});

	// ---------------------------------------------------------------
	// C# .csproj ProjectReference
	// ---------------------------------------------------------------

	it("detects .csproj ProjectReference entries", async () => {
		tmpDir = makeTmp();
		const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="..\\SharedLib\\SharedLib.csproj" />
    <ProjectReference Include="..\\Utils\\Utils.csproj" />
  </ItemGroup>
</Project>`;
		writeFileSync(join(tmpDir, "MyApp.csproj"), csproj);

		const contracts = await detectApiContracts(tmpDir);

		expect(contracts).toHaveLength(2);
		expect(contracts[0]).toEqual({
			type: "csproj-reference",
			specPath: "..\\SharedLib\\SharedLib.csproj",
		});
		expect(contracts[1]).toEqual({
			type: "csproj-reference",
			specPath: "..\\Utils\\Utils.csproj",
		});
	});

	// ---------------------------------------------------------------
	// Cargo.toml workspace members
	// ---------------------------------------------------------------

	it("detects Cargo.toml workspace members", async () => {
		tmpDir = makeTmp();
		const cargo = `[workspace]
members = [
  "crates/core",
  "crates/cli"
]
`;
		writeFileSync(join(tmpDir, "Cargo.toml"), cargo);

		const contracts = await detectApiContracts(tmpDir);

		expect(contracts).toHaveLength(2);
		expect(contracts[0]).toEqual({ type: "cargo-dependency", specPath: "crates/core" });
		expect(contracts[1]).toEqual({ type: "cargo-dependency", specPath: "crates/cli" });
	});

	// ---------------------------------------------------------------
	// go.mod replace directives
	// ---------------------------------------------------------------

	it("detects go.mod replace directives", async () => {
		tmpDir = makeTmp();
		const gomod = `module example.com/myapp

go 1.21

replace example.com/shared => ../shared
replace example.com/utils => ../utils
`;
		writeFileSync(join(tmpDir, "go.mod"), gomod);

		const contracts = await detectApiContracts(tmpDir);

		expect(contracts).toHaveLength(2);
		expect(contracts[0]).toEqual({ type: "go-mod-replace", specPath: "../shared" });
		expect(contracts[1]).toEqual({ type: "go-mod-replace", specPath: "../utils" });
	});

	// ---------------------------------------------------------------
	// pyproject.toml path dependencies
	// ---------------------------------------------------------------

	it("detects pyproject.toml path dependencies", async () => {
		tmpDir = makeTmp();
		const pyproject = `[tool.poetry.dependencies]
my-lib = { path = "../my-lib", develop = true }
utils = { path = "../utils" }
`;
		writeFileSync(join(tmpDir, "pyproject.toml"), pyproject);

		const contracts = await detectApiContracts(tmpDir);

		expect(contracts).toHaveLength(2);
		expect(contracts[0]).toEqual({ type: "python-path-dep", specPath: "../my-lib" });
		expect(contracts[1]).toEqual({ type: "python-path-dep", specPath: "../utils" });
	});

	// ---------------------------------------------------------------
	// Gradle settings.gradle
	// ---------------------------------------------------------------

	it("detects Gradle settings.gradle projects", async () => {
		tmpDir = makeTmp();
		const gradle = `rootProject.name = 'my-app'
include ':app', ':lib'
`;
		writeFileSync(join(tmpDir, "settings.gradle"), gradle);

		const contracts = await detectApiContracts(tmpDir);

		expect(contracts).toHaveLength(2);
		expect(contracts[0]).toEqual({ type: "gradle-project", specPath: "app" });
		expect(contracts[1]).toEqual({ type: "gradle-project", specPath: "lib" });
	});

	// ---------------------------------------------------------------
	// Empty repo
	// ---------------------------------------------------------------

	it("returns empty for repo with no contracts", async () => {
		tmpDir = makeTmp();
		// Write a file that is not an API contract
		writeFileSync(join(tmpDir, "README.md"), "# Hello");

		const contracts = await detectApiContracts(tmpDir);

		expect(contracts).toHaveLength(0);
	});
});
