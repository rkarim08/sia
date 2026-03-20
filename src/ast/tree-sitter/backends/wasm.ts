import type { ParserBackend } from "./native";

export async function tryLoadWasmBackend(): Promise<ParserBackend | null> {
  try {
    const TreeSitter = (await import("web-tree-sitter")).default;
    await TreeSitter.init();

    return {
      type: "wasm",
      createParser() {
        return new TreeSitter();
      },
      async loadLanguage(wasmPath: string, _entrypoint?: string) {
        return await TreeSitter.Language.load(wasmPath);
      },
      setTimeoutMicros(parser: any, micros: number) {
        if (typeof parser.setTimeoutMicros === "function") {
          parser.setTimeoutMicros(micros);
        }
      },
      parse(parser: any, source: string, language: unknown, previousTree?: unknown) {
        parser.setLanguage(language);
        return parser.parse(source, previousTree as any) ?? null;
      },
      query(language: any, querySource: string) {
        return language.query(querySource);
      },
      getChangedRanges(oldTree: any, newTree: any) {
        if (typeof oldTree.getChangedRanges === "function") {
          return oldTree.getChangedRanges(newTree);
        }
        return [];
      },
    };
  } catch {
    return null;
  }
}
