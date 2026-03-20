import { join } from "node:path";
import type { TreeSitterConfig } from "@/shared/config";
import { resolveLanguageConfig, type LanguageConfig } from "@/ast/languages";
import type { ParserBackend } from "./backends/native";
import { tryLoadNativeBackend } from "./backends/native";
import { tryLoadWasmBackend } from "./backends/wasm";
import { TreeCache } from "./tree-cache";
import { loadQuerySource, mapMatchesToSiaMatches } from "./query-runner";
import { walkTree } from "./call-walker";
import type {
  ITreeSitterService,
  TreeSitterBackend,
  SiaQueryMatch,
  TreeSitterRange,
  NodeVisitor,
  Point,
} from "./types";

export class TreeSitterService implements ITreeSitterService {
  private _backend: TreeSitterBackend = "unavailable";
  private parserBackend: ParserBackend | null = null;
  private parser: unknown = null;
  private languages = new Map<string, unknown>();
  private treeCache: TreeCache;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly config: TreeSitterConfig) {
    this.treeCache = new TreeCache(config.maxCachedTrees);
  }

  get backend(): TreeSitterBackend {
    return this._backend;
  }

  get cache(): TreeCache {
    return this.treeCache;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._initialize();
    await this.initPromise;
  }

  private async _initialize(): Promise<void> {
    if (!this.config.enabled) {
      this._backend = "unavailable";
      this.initialized = true;
      return;
    }

    if (this.config.preferNative) {
      this.parserBackend = await tryLoadNativeBackend();
      if (this.parserBackend) {
        this._backend = "native";
        this.parser = this.parserBackend.createParser();
        this.parserBackend.setTimeoutMicros(this.parser, this.config.parseTimeoutMs * 1000);
        this.initialized = true;
        return;
      }
    }

    this.parserBackend = await tryLoadWasmBackend();
    if (this.parserBackend) {
      this._backend = "wasm";
      this.parser = this.parserBackend.createParser();
      this.parserBackend.setTimeoutMicros(this.parser, this.config.parseTimeoutMs * 1000);
      this.initialized = true;
      return;
    }

    this._backend = "unavailable";
    this.initialized = true;
  }

  private async ensureLanguage(langConfig: LanguageConfig): Promise<unknown | null> {
    const resolved = resolveLanguageConfig(langConfig);
    const key = `${resolved.nativePackage}:${resolved.parserEntrypoint ?? "default"}`;
    const cached = this.languages.get(key);
    if (cached) return cached;
    if (!this.parserBackend) return null;

    try {
      let grammarRef: string;
      if (this._backend === "wasm") {
        grammarRef = join(this.config.wasmDir, resolved.wasmFile);
      } else {
        grammarRef = resolved.nativePackage;
      }
      const language = await this.parserBackend.loadLanguage(grammarRef, resolved.parserEntrypoint);
      this.languages.set(key, language);
      return language;
    } catch {
      return null;
    }
  }

  async parse(source: string, langName: string, previousTree?: unknown): Promise<unknown | null> {
    await this.initialize();
    if (!this.parserBackend || !this.parser) return null;

    const { LANGUAGE_REGISTRY } = await import("@/ast/languages");
    const langConfig = LANGUAGE_REGISTRY[langName];
    if (!langConfig) return null;

    const language = await this.ensureLanguage(langConfig);
    if (!language) return null;

    try {
      return this.parserBackend.parse(this.parser, source, language, previousTree);
    } catch {
      return null;
    }
  }

  query(
    tree: unknown,
    querySchemePath: string,
    startPosition?: Point,
    endPosition?: Point,
  ): SiaQueryMatch[] {
    if (!this.parserBackend || !tree) return [];
    try {
      const querySource = loadQuerySource(querySchemePath);
      const treeAny = tree as any;
      const language = treeAny.getLanguage?.() ?? treeAny.rootNode?.language;
      if (!language) return [];

      const queryObj = this.parserBackend.query(language, querySource);
      const queryAny = queryObj as any;

      const options: any = {};
      if (startPosition) options.startPosition = startPosition;
      if (endPosition) options.endPosition = endPosition;

      const rootNode = treeAny.rootNode ?? treeAny;
      const matches = queryAny.matches?.(rootNode, options) ?? [];
      return mapMatchesToSiaMatches(matches);
    } catch {
      return [];
    }
  }

  walk(tree: unknown, visitor: NodeVisitor): void {
    walkTree(tree, visitor);
  }

  getChangedRanges(oldTree: unknown, newTree: unknown): TreeSitterRange[] {
    if (!this.parserBackend) return [];
    try {
      const ranges = this.parserBackend.getChangedRanges(oldTree, newTree);
      return ranges.map((r) => ({
        startPosition: r.startPosition,
        endPosition: r.endPosition,
        startIndex: r.startIndex,
        endIndex: r.endIndex,
      }));
    } catch {
      return [];
    }
  }

  dispose(): void {
    this.treeCache.clear();
    this.languages.clear();
    this.parser = null;
    this.parserBackend = null;
    this._backend = "unavailable";
    this.initialized = false;
    this.initPromise = null;
  }
}
