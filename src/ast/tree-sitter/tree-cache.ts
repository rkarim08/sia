export interface TreeCacheEntry {
  tree: unknown;
  source: string;
}

export class TreeCache {
  private cache = new Map<string, TreeCacheEntry>();

  constructor(private readonly maxSize: number) {}

  get size(): number {
    return this.cache.size;
  }

  get(filePath: string): TreeCacheEntry | undefined {
    const entry = this.cache.get(filePath);
    if (!entry) return undefined;
    this.cache.delete(filePath);
    this.cache.set(filePath, entry);
    return entry;
  }

  set(filePath: string, tree: unknown, source: string): void {
    this.cache.delete(filePath);
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
    this.cache.set(filePath, { tree, source });
  }

  delete(filePath: string): boolean {
    return this.cache.delete(filePath);
  }

  clear(): void {
    this.cache.clear();
  }
}
