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

/**
 * These tests verify the ESM interop logic inside tryLoadWasmBackend.
 * Since bun does not support vi.doMock/vi.resetModules, we extract and
 * replicate the resolution logic from tryLoadWasmBackend inline.
 * This tests the same branching: mod.default ?? mod, init vs Parser.init.
 */
describe("wasm backend — ESM interop (inline logic verification)", () => {
	// Helper that replicates the interop resolution from tryLoadWasmBackend
	async function resolveFromMod(mod: Record<string, unknown>) {
		const TreeSitter = ((mod as any).default ?? mod) as any;
		let ParserClass: any;
		if (typeof TreeSitter.init === "function") {
			await TreeSitter.init();
			ParserClass = TreeSitter;
		} else if (typeof TreeSitter.Parser?.init === "function") {
			await TreeSitter.Parser.init();
			ParserClass = TreeSitter.Parser;
		} else {
			ParserClass = TreeSitter;
		}

		const LanguageClass = ParserClass.Language ?? TreeSitter.Language;
		return { ParserClass, LanguageClass, type: "wasm" as const };
	}

	it("handles web-tree-sitter where default has init (standard ESM)", async () => {
		const Parser = class {
			static init = vi.fn(async () => {});
			static Language = { load: vi.fn(async () => ({})) };
			setLanguage = vi.fn();
			parse = vi.fn(() => ({ rootNode: {} }));
			setTimeoutMicros = vi.fn();
		};

		const result = await resolveFromMod({ default: Parser });

		expect(result.type).toBe("wasm");
		expect(result.ParserClass).toBe(Parser);
		expect(Parser.init).toHaveBeenCalled();
	});

	it("handles web-tree-sitter with no default export (named exports only)", async () => {
		const Parser = class {
			static init = vi.fn(async () => {});
			static Language = { load: vi.fn(async () => ({})) };
			setLanguage = vi.fn();
			parse = vi.fn(() => ({ rootNode: {} }));
			setTimeoutMicros = vi.fn();
		};

		// No default export — mod.default is undefined, so fallback to mod itself.
		// mod has .Parser and .Language but no .init at top level.
		// TreeSitter = mod.default ?? mod = mod
		// typeof mod.init === "function"? No (undefined).
		// typeof mod.Parser?.init === "function"? Yes.
		const result = await resolveFromMod({
			default: undefined,
			init: undefined,
			Parser,
			Language: Parser.Language,
		});

		expect(result.type).toBe("wasm");
		expect(result.ParserClass).toBe(Parser);
		expect(Parser.init).toHaveBeenCalled();
	});

	it("handles web-tree-sitter where default lacks init but has Parser (CJS interop)", async () => {
		const Parser = class {
			static init = vi.fn(async () => {});
			static Language = { load: vi.fn(async () => ({})) };
			setLanguage = vi.fn();
			parse = vi.fn(() => ({ rootNode: {} }));
			setTimeoutMicros = vi.fn();
		};

		// CJS interop: mod.default = { Parser, Language }
		// TreeSitter = mod.default = { Parser, Language }
		// typeof TreeSitter.init? undefined (not a function).
		// typeof TreeSitter.Parser?.init? yes → calls Parser.init().
		const result = await resolveFromMod({
			default: { Parser, Language: Parser.Language },
			init: undefined,
		});

		expect(result.type).toBe("wasm");
		expect(result.ParserClass).toBe(Parser);
		expect(Parser.init).toHaveBeenCalled();
	});
});
