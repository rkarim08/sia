import { describe, expect, it, vi } from "vitest";
import { formatModelStatus, handleModelsCommand } from "@/cli/commands/models";

describe("sia models CLI", () => {
	it("formatModelStatus returns human-readable status", () => {
		const output = formatModelStatus({
			installedTier: "T0",
			models: {
				"bge-small-en-v1.5": {
					version: "1.0",
					variant: "int8",
					sha256: "abc123",
					sizeBytes: 33_000_000,
					source: "huggingface",
					installedAt: "2026-03-26T00:00:00Z",
					tier: "T0",
				},
			},
			attentionHead: {
				trainingPhase: "rrf",
				feedbackEvents: 0,
				lastTrained: null,
				projectVariants: {},
			},
			schemaVersion: 1,
		});

		expect(output).toContain("T0");
		expect(output).toContain("bge-small");
		expect(output).toContain("33.0 MB");
	});
});

describe("handleModelsCommand", () => {
	function makeMockManager(tier: import("@/models/types").ModelTier = "T0") {
		return {
			getManifest: () => ({
				schemaVersion: 1,
				installedTier: tier,
				models: {},
				attentionHead: {
					trainingPhase: "none" as const,
					feedbackEvents: 0,
					lastTrained: null,
					projectVariants: {},
				},
			}),
			installModel: vi.fn(),
			removeModel: vi.fn(),
			setInstalledTier: vi.fn(),
		};
	}

	it("status returns formatted string", async () => {
		const mgr = makeMockManager();
		const result = await handleModelsCommand("status", undefined, mgr);
		expect(result).toContain("T0");
	});

	it("upgrade to same tier returns error", async () => {
		const mgr = makeMockManager("T1");
		const result = await handleModelsCommand("upgrade", "T1", mgr);
		expect(result).toContain("cannot upgrade");
	});

	it("downgrade to same tier returns error", async () => {
		const mgr = makeMockManager("T1");
		const result = await handleModelsCommand("downgrade", "T1", mgr);
		expect(result).toContain("cannot downgrade");
	});

	it("requires target tier for upgrade", async () => {
		const mgr = makeMockManager();
		const result = await handleModelsCommand("upgrade", undefined, mgr);
		expect(result).toContain("target tier required");
	});
});
