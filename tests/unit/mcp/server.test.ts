import { describe, expect, it } from "vitest";
import {
	createMcpServer,
	type McpServerDeps,
	SiaAstQueryInput,
	SiaAtTimeInput,
	SiaByFileInput,
	SiaCommunityInput,
	SiaExpandInput,
	SiaFlagInput,
	SiaImpactInput,
	SiaSearchInput,
	SiaSnapshotListInput,
	SiaSnapshotPruneInput,
	SiaSnapshotRestoreInput,
	TOOL_NAMES,
} from "@/mcp/server";
import { DEFAULT_CONFIG } from "@/shared/config";

// ---------------------------------------------------------------------------
// Minimal mock deps — enough for createMcpServer to accept, no real DB needed
// ---------------------------------------------------------------------------

const mockDeps: McpServerDeps = {
	graphDb: null as unknown as McpServerDeps["graphDb"],
	bridgeDb: null,
	metaDb: null,
	embedder: null,
	config: DEFAULT_CONFIG,
	sessionId: "test-session",
};

// ---------------------------------------------------------------------------
// createMcpServer
// ---------------------------------------------------------------------------

describe("createMcpServer", () => {
	it("returns a server object", () => {
		const server = createMcpServer();
		expect(server).toBeDefined();
		expect(typeof server.connect).toBe("function");
		expect(typeof server.close).toBe("function");
	});

	it("backward compat: createMcpServer() without deps still works", () => {
		// Should not throw when called without deps
		const server = createMcpServer();
		expect(server).toBeDefined();
		const registered = (server as unknown as { _registeredTools: Record<string, unknown> })
			._registeredTools;
		expect(Object.keys(registered)).toHaveLength(22);
	});

	it("registers all 22 tools", () => {
		const server = createMcpServer(mockDeps);
		// The internal _registeredTools is a plain object keyed by tool name.
		const registered = (server as unknown as { _registeredTools: Record<string, unknown> })
			._registeredTools;
		expect(registered).toBeDefined();
		const registeredNames = Object.keys(registered);
		expect(registeredNames).toHaveLength(22);
		for (const name of TOOL_NAMES) {
			expect(name in registered).toBe(true);
		}
	});

	it("TOOL_NAMES contains exactly the expected names", () => {
		expect([...TOOL_NAMES]).toEqual([
			"sia_search",
			"sia_by_file",
			"sia_expand",
			"sia_community",
			"sia_at_time",
			"sia_flag",
			"sia_backlinks",
			"sia_note",
			"sia_execute",
			"sia_execute_file",
			"sia_index",
			"sia_batch_execute",
			"sia_fetch_and_index",
			"sia_stats",
			"sia_doctor",
			"sia_upgrade",
			"sia_sync_status",
			"sia_ast_query",
			"sia_impact",
			"sia_snapshot_list",
			"sia_snapshot_restore",
			"sia_snapshot_prune",
		]);
	});
	it("all tools have annotations with readOnlyHint", () => {
		const server = createMcpServer(mockDeps);
		const registered = (
			server as unknown as {
				_registeredTools: Record<string, { annotations?: { readOnlyHint?: boolean } }>;
			}
		)._registeredTools;

		const readOnlyTools = [
			"sia_search",
			"sia_by_file",
			"sia_expand",
			"sia_community",
			"sia_at_time",
			"sia_backlinks",
			"sia_stats",
			"sia_doctor",
			"sia_sync_status",
			"sia_ast_query",
			"sia_impact",
			"sia_snapshot_list",
		];
		const writeTools = [
			"sia_flag",
			"sia_note",
			"sia_execute",
			"sia_execute_file",
			"sia_index",
			"sia_batch_execute",
			"sia_fetch_and_index",
			"sia_upgrade",
			"sia_snapshot_restore",
			"sia_snapshot_prune",
		];

		for (const name of readOnlyTools) {
			expect(registered[name]?.annotations?.readOnlyHint, `${name} should be readOnly`).toBe(true);
		}
		for (const name of writeTools) {
			expect(registered[name]?.annotations?.readOnlyHint, `${name} should not be readOnly`).toBe(
				false,
			);
		}
	});
});

// ---------------------------------------------------------------------------
// Zod input schemas — validation tests
// ---------------------------------------------------------------------------

describe("SiaSearchInput", () => {
	it("accepts minimal valid input", () => {
		const result = SiaSearchInput.safeParse({ query: "auth module" });
		expect(result.success).toBe(true);
	});

	it("accepts full input", () => {
		const result = SiaSearchInput.safeParse({
			query: "auth module",
			task_type: "orientation",
			node_types: ["Decision", "Convention"],
			package_path: "src/auth",
			workspace: true,
			paranoid: false,
			limit: 10,
			include_provenance: true,
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing query", () => {
		const result = SiaSearchInput.safeParse({});
		expect(result.success).toBe(false);
	});

	it("rejects invalid task_type", () => {
		const result = SiaSearchInput.safeParse({ query: "x", task_type: "invalid" });
		expect(result.success).toBe(false);
	});
});

describe("SiaByFileInput", () => {
	it("accepts minimal valid input", () => {
		const result = SiaByFileInput.safeParse({ file_path: "src/index.ts" });
		expect(result.success).toBe(true);
	});

	it("accepts full input", () => {
		const result = SiaByFileInput.safeParse({
			file_path: "src/index.ts",
			workspace: true,
			limit: 5,
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing file_path", () => {
		const result = SiaByFileInput.safeParse({});
		expect(result.success).toBe(false);
	});
});

describe("SiaExpandInput", () => {
	it("accepts minimal valid input", () => {
		const result = SiaExpandInput.safeParse({ entity_id: "abc-123" });
		expect(result.success).toBe(true);
	});

	it("accepts valid depth values", () => {
		for (const depth of [1, 2, 3]) {
			const result = SiaExpandInput.safeParse({ entity_id: "abc", depth });
			expect(result.success).toBe(true);
		}
	});

	it("rejects invalid depth", () => {
		const result = SiaExpandInput.safeParse({ entity_id: "abc", depth: 4 });
		expect(result.success).toBe(false);
	});

	it("rejects missing entity_id", () => {
		const result = SiaExpandInput.safeParse({});
		expect(result.success).toBe(false);
	});
});

describe("SiaCommunityInput", () => {
	it("accepts empty input (all fields optional)", () => {
		const result = SiaCommunityInput.safeParse({});
		expect(result.success).toBe(true);
	});

	it("accepts query and level", () => {
		const result = SiaCommunityInput.safeParse({ query: "auth", level: 1 });
		expect(result.success).toBe(true);
	});

	it("rejects invalid level", () => {
		const result = SiaCommunityInput.safeParse({ level: 5 });
		expect(result.success).toBe(false);
	});
});

describe("SiaAtTimeInput", () => {
	it("accepts minimal valid input", () => {
		const result = SiaAtTimeInput.safeParse({ as_of: "2025-01-15T00:00:00Z" });
		expect(result.success).toBe(true);
	});

	it("accepts full input", () => {
		const result = SiaAtTimeInput.safeParse({
			as_of: "2025-01-15T00:00:00Z",
			entity_types: ["Decision"],
			tags: ["architecture"],
			limit: 20,
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing as_of", () => {
		const result = SiaAtTimeInput.safeParse({});
		expect(result.success).toBe(false);
	});
});

describe("SiaFlagInput", () => {
	it("accepts valid input", () => {
		const result = SiaFlagInput.safeParse({ reason: "hallucinated node" });
		expect(result.success).toBe(true);
	});

	it("rejects missing reason", () => {
		const result = SiaFlagInput.safeParse({});
		expect(result.success).toBe(false);
	});
});

describe("SiaAstQueryInput", () => {
	it("accepts minimal valid input", () => {
		const result = SiaAstQueryInput.safeParse({ file_path: "src/index.ts", query_type: "symbols" });
		expect(result.success).toBe(true);
	});

	it("accepts full input", () => {
		const result = SiaAstQueryInput.safeParse({
			file_path: "src/index.ts",
			query_type: "imports",
			max_results: 50,
		});
		expect(result.success).toBe(true);
	});

	it("accepts all query types", () => {
		for (const qt of ["symbols", "imports", "calls"]) {
			const result = SiaAstQueryInput.safeParse({ file_path: "a.ts", query_type: qt });
			expect(result.success).toBe(true);
		}
	});

	it("rejects invalid query_type", () => {
		const result = SiaAstQueryInput.safeParse({ file_path: "a.ts", query_type: "invalid" });
		expect(result.success).toBe(false);
	});

	it("rejects missing file_path", () => {
		const result = SiaAstQueryInput.safeParse({ query_type: "symbols" });
		expect(result.success).toBe(false);
	});

	it("rejects missing query_type", () => {
		const result = SiaAstQueryInput.safeParse({ file_path: "a.ts" });
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Snapshot Zod schemas
// ---------------------------------------------------------------------------

describe("SiaSnapshotListInput", () => {
	it("accepts empty input", () => {
		const result = SiaSnapshotListInput.safeParse({});
		expect(result.success).toBe(true);
	});
});

describe("SiaSnapshotRestoreInput", () => {
	it("accepts valid input", () => {
		const result = SiaSnapshotRestoreInput.safeParse({ branch_name: "main" });
		expect(result.success).toBe(true);
	});

	it("rejects missing branch_name", () => {
		const result = SiaSnapshotRestoreInput.safeParse({});
		expect(result.success).toBe(false);
	});
});

describe("SiaSnapshotPruneInput", () => {
	it("accepts valid input", () => {
		const result = SiaSnapshotPruneInput.safeParse({ branch_names: ["old-branch", "stale"] });
		expect(result.success).toBe(true);
	});

	it("accepts empty array", () => {
		const result = SiaSnapshotPruneInput.safeParse({ branch_names: [] });
		expect(result.success).toBe(true);
	});

	it("rejects missing branch_names", () => {
		const result = SiaSnapshotPruneInput.safeParse({});
		expect(result.success).toBe(false);
	});

	it("rejects non-array branch_names", () => {
		const result = SiaSnapshotPruneInput.safeParse({ branch_names: "single-string" });
		expect(result.success).toBe(false);
	});
});
