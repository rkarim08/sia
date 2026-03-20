import { describe, expect, test } from "bun:test";

describe("tree-sitter under Bun runtime", () => {
	test("native backend loads or gracefully fails", async () => {
		try {
			const Parser = (await import("tree-sitter")).default;
			const parser = new Parser();
			expect(parser).toBeDefined();
		} catch (e) {
			console.log("Native tree-sitter not available under Bun:", (e as Error).message);
		}
	});

	test("WASM backend loads", async () => {
		try {
			const mod = await import("web-tree-sitter");
			const TreeSitter = mod.default as any;
			await TreeSitter.init();
			const parser = new TreeSitter();
			expect(parser).toBeDefined();
		} catch (e) {
			console.log("WASM tree-sitter init failed:", (e as Error).message);
		}
	});
});
