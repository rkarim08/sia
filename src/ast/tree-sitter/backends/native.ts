export interface ParserBackend {
  type: "native" | "wasm";
  createParser(): unknown;
  loadLanguage(grammarPackage: string, entrypoint?: string): Promise<unknown>;
  setTimeoutMicros(parser: unknown, micros: number): void;
  parse(parser: unknown, source: string, language: unknown, previousTree?: unknown): unknown | null;
  query(language: unknown, querySource: string): unknown;
  getChangedRanges(
    oldTree: unknown,
    newTree: unknown,
  ): Array<{
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
    startIndex: number;
    endIndex: number;
  }>;
}

export async function tryLoadNativeBackend(): Promise<ParserBackend | null> {
  try {
    const Parser = (await import("tree-sitter")).default;

    return {
      type: "native",
      createParser() {
        return new Parser();
      },
      async loadLanguage(grammarPackage: string, entrypoint?: string) {
        const mod = await import(grammarPackage);
        const lang = entrypoint ? (mod[entrypoint] ?? mod.default) : (mod.default ?? mod);
        return lang;
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
        // biome-ignore lint/style/noVar: dynamic require needed for native module
        var NativeParser = require("tree-sitter");
        return new NativeParser.Query(language, querySource);
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
