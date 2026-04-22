import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");

describe("plugin smoke test", () => {
	it("should have a valid plugin.json manifest with inline mcpServers", () => {
		const path = join(ROOT, ".claude-plugin/plugin.json");
		expect(existsSync(path)).toBe(true);
		const manifest = JSON.parse(readFileSync(path, "utf-8"));
		expect(manifest.name).toBe("sia");
		expect(manifest.version).toBeTruthy();
		expect(manifest.description).toBeTruthy();
		expect(manifest.mcpServers).toBeDefined();
		expect(manifest.mcpServers.sia).toBeDefined();
		expect(manifest.mcpServers.sia.command).toBeTruthy();
	});

	it("should have hooks.json with expected events", () => {
		const path = join(ROOT, "hooks/hooks.json");
		expect(existsSync(path)).toBe(true);
		const hooks = JSON.parse(readFileSync(path, "utf-8"));
		expect(hooks.hooks.PostToolUse).toBeDefined();
		expect(hooks.hooks.Stop).toBeDefined();
		expect(hooks.hooks.SessionStart).toBeDefined();
		expect(hooks.hooks.PreCompact).toBeDefined();
		expect(hooks.hooks.PostCompact).toBeDefined();
		expect(hooks.hooks.SessionEnd).toBeDefined();
		expect(hooks.hooks.UserPromptSubmit).toBeDefined();
	});

	it("should have skill directories with SKILL.md files", () => {
		const skills = [
			"sia-install",
			"sia-search",
			"sia-stats",
			"sia-reindex",
			"sia-doctor",
			"sia-digest",
			"sia-visualize",
			"sia-execute",
			"sia-export-import",
			"sia-conflicts",
			"sia-freshness",
			"sia-prune",
			"sia-sync",
			"sia-team",
			"sia-workspace",
			"sia-index",
			"sia-upgrade",
		];
		for (const skill of skills) {
			const path = join(ROOT, `skills/${skill}/SKILL.md`);
			expect(existsSync(path), `Missing skill: ${skill}`).toBe(true);

			const content = readFileSync(path, "utf-8");
			expect(content).toContain("---");
			expect(content).toContain("name:");
			expect(content).toContain("description:");
		}
	});

	it("should have agent definitions", () => {
		const agents = ["sia-code-reviewer", "sia-orientation", "sia-regression", "sia-feature"];
		for (const agent of agents) {
			const path = join(ROOT, `agents/${agent}.md`);
			expect(existsSync(path), `Missing agent: ${agent}`).toBe(true);

			const content = readFileSync(path, "utf-8");
			expect(content).toContain("---");
			expect(content).toContain("whenToUse");
		}
	});

	it("should have executable hook scripts", () => {
		const scripts = [
			"scripts/post-tool-use.sh",
			"scripts/stop-hook.sh",
			"scripts/session-start.sh",
			"scripts/branch-switch.sh",
			"scripts/session-end.sh",
			"scripts/pre-compact.sh",
			"scripts/post-compact.sh",
			"scripts/user-prompt-submit.sh",
		];
		for (const script of scripts) {
			const path = join(ROOT, script);
			expect(existsSync(path), `Missing script: ${script}`).toBe(true);
		}
	});

	it("should have MCP server entry point", () => {
		const path = join(ROOT, "scripts/start-mcp.ts");
		expect(existsSync(path)).toBe(true);
	});

	it("MCP server should export createMcpServer and TOOL_NAMES", async () => {
		const { createMcpServer, TOOL_NAMES } = await import("@/mcp/server");
		expect(createMcpServer).toBeDefined();
		expect(typeof createMcpServer).toBe("function");
		expect(TOOL_NAMES.length).toBeGreaterThanOrEqual(13);
	});

	it("should have branch_snapshots migration", () => {
		const path = join(ROOT, "migrations/semantic/007_branch_snapshots.sql");
		expect(existsSync(path)).toBe(true);
	});
});
