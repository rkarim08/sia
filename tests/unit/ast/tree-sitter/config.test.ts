import { describe, expect, it } from "vitest";
import type { TreeSitterConfig } from "@/shared/config";
import { resolveLanguageConfig } from "@/ast/languages";

describe("TreeSitterConfig", () => {
  it("has correct defaults", () => {
    const config: TreeSitterConfig = {
      enabled: true,
      preferNative: true,
      parseTimeoutMs: 5000,
      maxCachedTrees: 500,
      wasmDir: "grammars/wasm",
      queryDir: "grammars/queries",
    };
    expect(config.enabled).toBe(true);
    expect(config.parseTimeoutMs).toBe(5000);
  });
});

describe("resolveLanguageConfig", () => {
  it("derives defaults from treeSitterGrammar", () => {
    const resolved = resolveLanguageConfig({
      name: "typescript",
      extensions: [".ts"],
      treeSitterGrammar: "tree-sitter-typescript",
      tier: "A" as const,
      extractors: { functions: true, classes: true, imports: true, calls: true },
    });
    expect(resolved.nativePackage).toBe("tree-sitter-typescript");
    expect(resolved.wasmFile).toBe("tree-sitter-typescript.wasm");
    expect(resolved.queryDir).toBe("typescript");
  });

  it("preserves explicit overrides", () => {
    const resolved = resolveLanguageConfig({
      name: "tsx",
      extensions: [".tsx"],
      treeSitterGrammar: "tree-sitter-typescript",
      tier: "A" as const,
      extractors: { functions: true, classes: true, imports: true, calls: true },
      nativePackage: "tree-sitter-typescript",
      parserEntrypoint: "tsx",
    });
    expect(resolved.parserEntrypoint).toBe("tsx");
    expect(resolved.nativePackage).toBe("tree-sitter-typescript");
  });
});
