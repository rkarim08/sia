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

describe("fallback cascade", () => {
	let service: TreeSitterService;

	afterEach(() => {
		service?.dispose();
	});

	it("disabled config returns unavailable backend", async () => {
		service = new TreeSitterService({ ...defaultConfig, enabled: false });
		await service.initialize();
		expect(service.backend).toBe("unavailable");
		const tree = await service.parse("const x = 1;", "typescript");
		expect(tree).toBeNull();
	});

	it("WASM-only mode skips native", async () => {
		service = new TreeSitterService({ ...defaultConfig, preferNative: false });
		await service.initialize();
		expect(["wasm", "unavailable"]).toContain(service.backend);
	});

	it("dispatchExtraction still works when tree-sitter unavailable", async () => {
		const { dispatchExtraction } = await import("@/ast/extractors/tier-dispatch");
		const facts = dispatchExtraction("function foo() {}", "test.ts", "A");
		expect(facts.length).toBeGreaterThan(0);
	});
});
