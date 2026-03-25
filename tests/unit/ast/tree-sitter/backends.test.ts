import { describe, expect, it, vi } from "vitest";
import { tryLoadNativeBackend } from "@/ast/tree-sitter/backends/native";
import { tryLoadWasmBackend } from "@/ast/tree-sitter/backends/wasm";

describe("native backend", () => {
	it("tryLoadNativeBackend returns a backend or null", async () => {
		const result = await tryLoadNativeBackend();
		if (result !== null) {
			expect(result.type).toBe("native");
			expect(typeof result.createParser).toBe("function");
			expect(typeof result.loadLanguage).toBe("function");
		} else {
			expect(result).toBeNull();
		}
	});
});

describe("wasm backend", () => {
	it("tryLoadWasmBackend returns a backend or null", async () => {
		const result = await tryLoadWasmBackend();
		if (result !== null) {
			expect(result.type).toBe("wasm");
			expect(typeof result.createParser).toBe("function");
			expect(typeof result.loadLanguage).toBe("function");
		} else {
			expect(result).toBeNull();
		}
	});
});

describe("wasm backend — ESM interop", () => {
	it("handles web-tree-sitter where default has init (standard ESM)", async () => {
		vi.resetModules();

		const Parser = class {
			static init = vi.fn(async () => {});
			static Language = { load: vi.fn(async () => ({})) };
			setLanguage = vi.fn();
			parse = vi.fn(() => ({ rootNode: {} }));
			setTimeoutMicros = vi.fn();
		};

		vi.doMock("web-tree-sitter", () => ({
			default: Parser,
		}));

		const { tryLoadWasmBackend: freshLoad } = await import("@/ast/tree-sitter/backends/wasm");
		const backend = await freshLoad();

		expect(backend).not.toBeNull();
		expect(backend?.type).toBe("wasm");
		expect(typeof backend?.createParser).toBe("function");
		expect(Parser.init).toHaveBeenCalled();

		vi.doUnmock("web-tree-sitter");
	});

	it("handles web-tree-sitter with no default export (named exports only)", async () => {
		vi.resetModules();

		const Parser = class {
			static init = vi.fn(async () => {});
			static Language = { load: vi.fn(async () => ({})) };
			setLanguage = vi.fn();
			parse = vi.fn(() => ({ rootNode: {} }));
			setTimeoutMicros = vi.fn();
		};

		// No default export — named exports only (the exact Bug 12 scenario).
		// Vitest requires all accessed properties to be declared in the mock,
		// so we explicitly set init/default to undefined.
		vi.doMock("web-tree-sitter", () => ({
			default: undefined,
			init: undefined,
			Parser,
			Language: Parser.Language,
		}));

		const { tryLoadWasmBackend: freshLoad } = await import("@/ast/tree-sitter/backends/wasm");
		const backend = await freshLoad();

		expect(backend).not.toBeNull();
		expect(backend?.type).toBe("wasm");
		expect(typeof backend?.createParser).toBe("function");
		expect(Parser.init).toHaveBeenCalled();

		vi.doUnmock("web-tree-sitter");
	});

	it("handles web-tree-sitter where default lacks init but has Parser (CJS interop)", async () => {
		vi.resetModules();

		const Parser = class {
			static init = vi.fn(async () => {});
			static Language = { load: vi.fn(async () => ({})) };
			setLanguage = vi.fn();
			parse = vi.fn(() => ({ rootNode: {} }));
			setTimeoutMicros = vi.fn();
		};

		// Simulate CJS interop: default is a plain object wrapping Parser
		vi.doMock("web-tree-sitter", () => ({
			default: { Parser, Language: Parser.Language },
		}));

		const { tryLoadWasmBackend: freshLoad } = await import("@/ast/tree-sitter/backends/wasm");
		const backend = await freshLoad();

		expect(backend).not.toBeNull();
		expect(backend?.type).toBe("wasm");
		expect(typeof backend?.createParser).toBe("function");
		expect(Parser.init).toHaveBeenCalled();

		vi.doUnmock("web-tree-sitter");
	});
});
