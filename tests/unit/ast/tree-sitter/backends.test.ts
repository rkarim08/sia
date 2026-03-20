import { describe, expect, it } from "vitest";
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
