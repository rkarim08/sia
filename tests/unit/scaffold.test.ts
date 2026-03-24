import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");

describe("project scaffold", () => {
	it("has package.json with correct name", async () => {
		const pkg = await import(resolve(ROOT, "package.json"));
		expect(pkg.name).toBe("@rkarim08/sia");
		expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
	});

	it("has tsconfig.json with strict mode", async () => {
		const tsconfig = await import(resolve(ROOT, "tsconfig.json"));
		expect(tsconfig.compilerOptions.strict).toBe(true);
	});

	const requiredDirs = [
		"src/graph",
		"src/workspace",
		"src/capture",
		"src/capture/prompts",
		"src/ast",
		"src/ast/extractors",
		"src/community",
		"src/retrieval",
		"src/mcp",
		"src/mcp/tools",
		"src/security",
		"src/sync",
		"src/decay",
		"src/cli",
		"src/cli/commands",
		"src/shared",
		"src/agent",
		"src/agent/modules",
		"migrations/meta",
		"migrations/bridge",
		"migrations/semantic",
		"migrations/episodic",
		"tests/unit",
		"tests/integration",
	];

	for (const dir of requiredDirs) {
		it(`has directory: ${dir}`, () => {
			expect(existsSync(resolve(ROOT, dir))).toBe(true);
		});
	}

	const requiredAgentModules = [
		"src/agent/claude-md-template.md",
		"src/agent/modules/sia-orientation.md",
		"src/agent/modules/sia-feature.md",
		"src/agent/modules/sia-regression.md",
		"src/agent/modules/sia-review.md",
		"src/agent/modules/sia-flagging.md",
		"src/agent/modules/sia-tools.md",
	];

	for (const file of requiredAgentModules) {
		it(`has agent template: ${file}`, () => {
			expect(existsSync(resolve(ROOT, file))).toBe(true);
		});
	}

	const coreStubs = [
		"src/graph/db-interface.ts",
		"src/graph/entities.ts",
		"src/graph/edges.ts",
		"src/mcp/server.ts",
		"src/capture/pipeline.ts",
		"src/shared/config.ts",
		"src/cli/index.ts",
	];

	for (const file of coreStubs) {
		it(`has stub file: ${file}`, () => {
			expect(existsSync(resolve(ROOT, file))).toBe(true);
		});
	}
});
