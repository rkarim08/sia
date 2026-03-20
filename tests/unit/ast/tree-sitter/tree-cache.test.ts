import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TreeCache } from "@/ast/tree-sitter/tree-cache";

describe("TreeCache", () => {
	let cache: TreeCache;

	beforeEach(() => {
		cache = new TreeCache(3); // max 3 entries
	});

	afterEach(() => {
		cache.clear();
	});

	it("stores and retrieves entries", () => {
		const tree = { type: "mock-tree" };
		cache.set("/a.ts", tree as any, "const a = 1;");
		const entry = cache.get("/a.ts");
		expect(entry).toBeDefined();
		expect(entry?.tree).toBe(tree);
		expect(entry?.source).toBe("const a = 1;");
	});

	it("returns undefined for missing keys", () => {
		expect(cache.get("/missing.ts")).toBeUndefined();
	});

	it("evicts least recently used when capacity exceeded", () => {
		cache.set("/a.ts", {} as any, "a");
		cache.set("/b.ts", {} as any, "b");
		cache.set("/c.ts", {} as any, "c");
		cache.get("/a.ts"); // access a to make it recent
		cache.set("/d.ts", {} as any, "d"); // should evict /b.ts
		expect(cache.get("/a.ts")).toBeDefined();
		expect(cache.get("/b.ts")).toBeUndefined();
		expect(cache.get("/c.ts")).toBeDefined();
		expect(cache.get("/d.ts")).toBeDefined();
	});

	it("updates existing entry without changing capacity", () => {
		cache.set("/a.ts", {} as any, "v1");
		cache.set("/a.ts", {} as any, "v2");
		expect(cache.get("/a.ts")?.source).toBe("v2");
		expect(cache.size).toBe(1);
	});

	it("delete removes an entry", () => {
		cache.set("/a.ts", {} as any, "a");
		cache.delete("/a.ts");
		expect(cache.get("/a.ts")).toBeUndefined();
		expect(cache.size).toBe(0);
	});

	it("clear empties the cache", () => {
		cache.set("/a.ts", {} as any, "a");
		cache.set("/b.ts", {} as any, "b");
		cache.clear();
		expect(cache.size).toBe(0);
	});
});
