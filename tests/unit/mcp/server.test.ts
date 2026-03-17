import { describe, expect, it } from "vitest";
import {
	createMcpServer,
	SiaAtTimeInput,
	SiaByFileInput,
	SiaCommunityInput,
	SiaExpandInput,
	SiaFlagInput,
	SiaSearchInput,
	TOOL_NAMES,
} from "@/mcp/server";

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

	it("registers all 6 tools", () => {
		const server = createMcpServer();
		// The internal _registeredTools is a plain object keyed by tool name.
		const registered = (server as unknown as { _registeredTools: Record<string, unknown> })
			._registeredTools;
		expect(registered).toBeDefined();
		const registeredNames = Object.keys(registered);
		expect(registeredNames).toHaveLength(6);
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
		]);
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
