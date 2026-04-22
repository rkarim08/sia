import { describe, expect, it } from "vitest";
import { handleSiaModels } from "@/mcp/tools/sia-models";
import type { ModelManager } from "@/models/manager";
import { createEmptyManifest } from "@/models/types";

function mockModelManager(overrides?: Partial<ReturnType<typeof createMockManager>>): ModelManager {
	return createMockManager(overrides);
}

function createMockManager(overrides?: Record<string, unknown>): ModelManager {
	const manifest = createEmptyManifest();
	return {
		getManifest: () => ({ ...manifest, ...overrides }),
		getModelPath: (_name: string, _file: string) => "/mock/path",
		isModelInstalled: (_name: string) => false,
		recordModelInstalled: () => {},
		removeModel: () => {},
		setInstalledTier: () => {},
		verifyChecksum: async () => true,
		getModelsDir: () => "/mock/models",
		updateAttentionHeadMeta: () => {},
	};
}

describe("handleSiaModels", () => {
	it("returns initialization message when modelManager is null", () => {
		const result = handleSiaModels({ action: "status" }, null);
		expect(result).toContain("not available");
	});

	it("returns formatted output with tier and attention head phase", () => {
		const manager = mockModelManager();
		const result = handleSiaModels({ action: "status" }, manager);
		expect(result).toContain("Installed tier: T0");
		expect(result).toContain("Attention head: none");
		expect(result).toContain("(none installed)");
	});

	it("lists installed models with tier, variant, and size", () => {
		const manifest = createEmptyManifest();
		manifest.installedTier = "T1";
		manifest.models["bge-small-en-v1.5"] = {
			version: "1.0",
			variant: "int8",
			sha256: "abc123",
			sizeBytes: 50_000_000,
			source: "huggingface",
			installedAt: new Date().toISOString(),
			tier: "T1",
		};
		const manager: ModelManager = {
			getManifest: () => manifest,
			getModelPath: () => "/mock/path",
			isModelInstalled: () => true,
			recordModelInstalled: () => {},
			removeModel: () => {},
			setInstalledTier: () => {},
			verifyChecksum: async () => true,
			getModelsDir: () => "/mock/models",
			updateAttentionHeadMeta: () => {},
		};

		const result = handleSiaModels({ action: "status" }, manager);
		expect(result).toContain("Installed tier: T1");
		expect(result).toContain("bge-small-en-v1.5");
		expect(result).toContain("int8");
		expect(result).toContain("48 MB"); // 50M / 1048576 ≈ 48
	});
});
