// Tests for the shared next-steps hint helper.

import { describe, expect, it } from "vitest";
import { buildNextSteps } from "@/mcp/next-steps";

describe("buildNextSteps", () => {
	it("returns [] for an unknown tool", () => {
		expect(buildNextSteps("no_such_tool", {})).toEqual([]);
	});

	// ---------------------------------------------------------------
	// sia_by_file branches
	// ---------------------------------------------------------------

	describe("sia_by_file", () => {
		it("suggests sia_search and sia_backlinks on hits", () => {
			const hints = buildNextSteps("sia_by_file", {
				resultCount: 3,
				topEntityId: "ent-1",
			});
			const tools = hints.map((h) => h.tool);
			expect(tools).toContain("sia_search");
			expect(tools).toContain("sia_backlinks");
			const bl = hints.find((h) => h.tool === "sia_backlinks");
			expect(bl?.args?.entity_id).toBe("ent-1");
		});

		it("suggests broader search on zero hits", () => {
			const hints = buildNextSteps("sia_by_file", { resultCount: 0 });
			expect(hints.length).toBeGreaterThan(0);
			expect(hints[0].tool).toBe("sia_search");
			expect(hints.map((h) => h.tool)).not.toContain("sia_backlinks");
		});
	});

	// ---------------------------------------------------------------
	// sia_expand branches
	// ---------------------------------------------------------------

	describe("sia_expand", () => {
		it("suggests sia_by_file with the top file path", () => {
			const hints = buildNextSteps("sia_expand", {
				resultCount: 5,
				topEntityId: "ent-1",
				topFilePath: "src/auth.ts",
				depthExplored: 1,
			});
			const bf = hints.find((h) => h.tool === "sia_by_file");
			expect(bf).toBeDefined();
			expect(bf?.args?.file_path).toBe("src/auth.ts");
		});

		it("suggests sia_impact when ≥ 3 layers expanded", () => {
			const hints = buildNextSteps("sia_expand", {
				topEntityId: "ent-1",
				topFilePath: "src/foo.ts",
				depthExplored: 3,
			});
			expect(hints.map((h) => h.tool)).toContain("sia_impact");
		});

		it("falls back to sia_impact when no file path known", () => {
			const hints = buildNextSteps("sia_expand", { topEntityId: "ent-1", depthExplored: 1 });
			expect(hints.map((h) => h.tool)).toContain("sia_impact");
		});
	});

	// ---------------------------------------------------------------
	// sia_community
	// ---------------------------------------------------------------

	describe("sia_community", () => {
		it("suggests sia_backlinks on community root + sia_search", () => {
			const hints = buildNextSteps("sia_community", { resultCount: 2, topEntityId: "c-1" });
			const tools = hints.map((h) => h.tool);
			expect(tools).toContain("sia_backlinks");
			expect(tools).toContain("sia_search");
			const bl = hints.find((h) => h.tool === "sia_backlinks");
			expect(bl?.args?.node_id).toBe("c-1");
		});

		it("still suggests sia_search when no community found", () => {
			const hints = buildNextSteps("sia_community", { resultCount: 0 });
			expect(hints.map((h) => h.tool)).toContain("sia_search");
		});
	});

	// ---------------------------------------------------------------
	// sia_backlinks
	// ---------------------------------------------------------------

	describe("sia_backlinks", () => {
		it("suggests sia_expand on the top caller", () => {
			const hints = buildNextSteps("sia_backlinks", { resultCount: 2, topEntityId: "caller-1" });
			const exp = hints.find((h) => h.tool === "sia_expand");
			expect(exp?.args?.entity_id).toBe("caller-1");
		});

		it("always suggests sia_impact", () => {
			const hints = buildNextSteps("sia_backlinks", { resultCount: 0 });
			expect(hints.map((h) => h.tool)).toContain("sia_impact");
		});
	});

	// ---------------------------------------------------------------
	// sia_note
	// ---------------------------------------------------------------

	describe("sia_note", () => {
		it("suggests sia_search for dedup verification", () => {
			const hints = buildNextSteps("sia_note", { kind: "Convention" });
			expect(hints.map((h) => h.tool)).toContain("sia_search");
			expect(hints.map((h) => h.tool)).not.toContain("sia_flag");
		});

		it("suggests sia_flag when kind=Decision", () => {
			const hints = buildNextSteps("sia_note", { kind: "Decision" });
			expect(hints.map((h) => h.tool)).toContain("sia_flag");
		});
	});

	// ---------------------------------------------------------------
	// sia_stats
	// ---------------------------------------------------------------

	describe("sia_stats", () => {
		it("suggests /sia-learn on an empty graph", () => {
			const hints = buildNextSteps("sia_stats", { emptyGraph: true });
			expect(hints.map((h) => h.tool)).toContain("/sia-learn");
		});

		it("suggests /sia-capture when tier-3 count > 5", () => {
			const hints = buildNextSteps("sia_stats", { tier3Count: 12 });
			expect(hints.map((h) => h.tool)).toContain("/sia-capture");
		});

		it("suggests sia_doctor for normal graphs", () => {
			const hints = buildNextSteps("sia_stats", { tier3Count: 0 });
			expect(hints.map((h) => h.tool)).toContain("sia_doctor");
		});
	});

	// ---------------------------------------------------------------
	// sia_doctor
	// ---------------------------------------------------------------

	describe("sia_doctor", () => {
		it("suggests sia_upgrade and /sia-setup on failure", () => {
			const hints = buildNextSteps("sia_doctor", { hasFailure: true });
			const tools = hints.map((h) => h.tool);
			expect(tools).toContain("sia_upgrade");
			expect(tools).toContain("/sia-setup");
		});

		it("suggests sia_stats when healthy", () => {
			const hints = buildNextSteps("sia_doctor", { hasFailure: false });
			expect(hints.map((h) => h.tool)).toContain("sia_stats");
		});
	});

	// ---------------------------------------------------------------
	// sia_upgrade
	// ---------------------------------------------------------------

	describe("sia_upgrade", () => {
		it("suggests sia_doctor on success", () => {
			const hints = buildNextSteps("sia_upgrade", { hasFailure: false });
			expect(hints.map((h) => h.tool)).toContain("sia_doctor");
		});

		it("suggests sia_doctor on failure too", () => {
			const hints = buildNextSteps("sia_upgrade", { hasFailure: true });
			expect(hints.map((h) => h.tool)).toContain("sia_doctor");
		});
	});

	// ---------------------------------------------------------------
	// sia_sync_status
	// ---------------------------------------------------------------

	describe("sia_sync_status", () => {
		it("returns no hints on normal status", () => {
			expect(buildNextSteps("sia_sync_status", { hasFailure: false })).toEqual([]);
		});

		it("suggests sia_doctor on errors", () => {
			const hints = buildNextSteps("sia_sync_status", { hasFailure: true });
			expect(hints.map((h) => h.tool)).toContain("sia_doctor");
		});
	});

	// ---------------------------------------------------------------
	// sia_detect_changes
	// ---------------------------------------------------------------

	describe("sia_detect_changes", () => {
		it("suggests sia_impact + sia_by_file when files changed", () => {
			const hints = buildNextSteps("sia_detect_changes", {
				changedFiles: ["src/a.ts", "src/b.ts"],
			});
			const tools = hints.map((h) => h.tool);
			expect(tools).toContain("sia_impact");
			expect(tools).toContain("sia_by_file");
			const bf = hints.find((h) => h.tool === "sia_by_file");
			expect(bf?.args?.file_path).toBe("src/a.ts");
		});

		it("returns [] when no files changed", () => {
			expect(buildNextSteps("sia_detect_changes", { changedFiles: [] })).toEqual([]);
		});
	});

	// ---------------------------------------------------------------
	// sia_index
	// ---------------------------------------------------------------

	describe("sia_index", () => {
		it("suggests sia_search when chunks indexed", () => {
			const hints = buildNextSteps("sia_index", { resultCount: 3 });
			expect(hints.map((h) => h.tool)).toContain("sia_search");
		});

		it("returns [] when nothing indexed", () => {
			expect(buildNextSteps("sia_index", { resultCount: 0 })).toEqual([]);
		});
	});

	// ---------------------------------------------------------------
	// sia_batch_execute
	// ---------------------------------------------------------------

	describe("sia_batch_execute", () => {
		it("returns [] on success", () => {
			expect(buildNextSteps("sia_batch_execute", { hasFailure: false })).toEqual([]);
		});

		it("suggests sia_doctor on failure", () => {
			const hints = buildNextSteps("sia_batch_execute", { hasFailure: true });
			expect(hints.map((h) => h.tool)).toContain("sia_doctor");
		});
	});

	// ---------------------------------------------------------------
	// sia_fetch_and_index
	// ---------------------------------------------------------------

	describe("sia_fetch_and_index", () => {
		it("suggests sia_search on success", () => {
			const hints = buildNextSteps("sia_fetch_and_index", { hasFailure: false });
			expect(hints.map((h) => h.tool)).toContain("sia_search");
		});

		it("returns [] on failure", () => {
			expect(buildNextSteps("sia_fetch_and_index", { hasFailure: true })).toEqual([]);
		});
	});

	// ---------------------------------------------------------------
	// sia_flag
	// ---------------------------------------------------------------

	describe("sia_flag", () => {
		it("suggests sia_search after a flag", () => {
			const hints = buildNextSteps("sia_flag", { hasFailure: false });
			expect(hints.map((h) => h.tool)).toContain("sia_search");
		});
	});

	// ---------------------------------------------------------------
	// sia_models
	// ---------------------------------------------------------------

	describe("sia_models", () => {
		it("suggests sia_doctor", () => {
			const hints = buildNextSteps("sia_models", {});
			expect(hints.map((h) => h.tool)).toContain("sia_doctor");
		});
	});

	// ---------------------------------------------------------------
	// snapshot tools
	// ---------------------------------------------------------------

	describe("sia_snapshot_list", () => {
		it("suggests sia_snapshot_restore on the newest entry", () => {
			const hints = buildNextSteps("sia_snapshot_list", {
				resultCount: 2,
				newestBranchName: "main",
			});
			const restore = hints.find((h) => h.tool === "sia_snapshot_restore");
			expect(restore?.args?.branch_name).toBe("main");
		});

		it("returns [] when no snapshots", () => {
			expect(buildNextSteps("sia_snapshot_list", { resultCount: 0 })).toEqual([]);
		});
	});

	describe("sia_snapshot_restore", () => {
		it("suggests sia_doctor to verify", () => {
			const hints = buildNextSteps("sia_snapshot_restore", {});
			expect(hints.map((h) => h.tool)).toContain("sia_doctor");
		});
	});

	describe("sia_snapshot_prune", () => {
		it("suggests sia_snapshot_list to confirm", () => {
			const hints = buildNextSteps("sia_snapshot_prune", {});
			expect(hints.map((h) => h.tool)).toContain("sia_snapshot_list");
		});
	});
});
