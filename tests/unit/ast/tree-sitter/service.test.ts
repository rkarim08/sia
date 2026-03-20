import { afterEach, describe, expect, it } from "vitest";
import { TreeSitterService } from "@/ast/tree-sitter/service";
import type { TreeSitterConfig } from "@/shared/config";

const defaultConfig: TreeSitterConfig = {
	enabled: true,
	preferNative: true,
	parseTimeoutMs: 5000,
	maxCachedTrees: 100,
	wasmDir: "grammars/wasm",
	queryDir: "grammars/queries",
};

describe("TreeSitterService", () => {
	let service: TreeSitterService;

	afterEach(() => {
		service?.dispose();
	});

	it("initializes lazily (no backend until first parse)", () => {
		service = new TreeSitterService(defaultConfig);
		expect(service.backend).toBe("unavailable");
	});

	it("reports backend after first initialization attempt", async () => {
		service = new TreeSitterService(defaultConfig);
		await service.initialize();
		expect(["native", "wasm", "unavailable"]).toContain(service.backend);
	});

	it("dispose resets to uninitialized", async () => {
		service = new TreeSitterService(defaultConfig);
		await service.initialize();
		service.dispose();
		expect(service.backend).toBe("unavailable");
	});

	it("returns null from parse when disabled", async () => {
		service = new TreeSitterService({ ...defaultConfig, enabled: false });
		const result = await service.parse("const x = 1;", "typescript");
		expect(result).toBeNull();
	});
});
