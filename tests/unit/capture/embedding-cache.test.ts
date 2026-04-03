import { describe, expect, it, vi } from "vitest";
import type { Embedder } from "@/capture/embedder";
import { createCachedEmbedder } from "@/capture/embedding-cache";

/** Create a mock Embedder whose embed returns a deterministic Float32Array. */
function mockEmbedder(): Embedder {
	const embedFn = vi.fn(async (_text: string, _trustTier?: number) => new Float32Array([1, 2, 3]));
	return {
		embed: embedFn,
		embedBatch: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([1, 2, 3]))),
		close: vi.fn(),
	};
}

describe("createCachedEmbedder", () => {
	// ---------------------------------------------------------------
	// Same text N times — inner.embed called only once
	// ---------------------------------------------------------------

	it("calls inner.embed only once for 100 identical texts", async () => {
		const inner = mockEmbedder();
		const cached = createCachedEmbedder(inner);

		for (let i = 0; i < 100; i++) {
			const result = await cached.embed("hello");
			expect(result).toEqual(new Float32Array([1, 2, 3]));
		}

		expect(inner.embed).toHaveBeenCalledTimes(1);
	});

	// ---------------------------------------------------------------
	// Different texts — separate cache entries
	// ---------------------------------------------------------------

	it("creates separate cache entries for different texts", async () => {
		const inner = mockEmbedder();
		const cached = createCachedEmbedder(inner);

		await cached.embed("alpha");
		await cached.embed("beta");
		await cached.embed("gamma");

		expect(inner.embed).toHaveBeenCalledTimes(3);
	});

	// ---------------------------------------------------------------
	// LRU eviction — oldest entry evicted when full
	// ---------------------------------------------------------------

	it("evicts the oldest entry when maxSize is exceeded", async () => {
		const inner = mockEmbedder();
		const cached = createCachedEmbedder(inner, { maxSize: 3 });

		await cached.embed("a");
		await cached.embed("b");
		await cached.embed("c");
		// Cache is full: [a, b, c]

		expect(inner.embed).toHaveBeenCalledTimes(3);

		await cached.embed("d");
		// "a" should be evicted: [b, c, d]

		expect(inner.embed).toHaveBeenCalledTimes(4);

		// "a" was evicted, so embedding it again should call inner.embed
		await cached.embed("a");
		// "b" is now evicted to make room: [c, d, a]
		expect(inner.embed).toHaveBeenCalledTimes(5);

		// "c" and "d" should still be in cache
		await cached.embed("c");
		await cached.embed("d");
		expect(inner.embed).toHaveBeenCalledTimes(5);

		// "b" was evicted, so it should call inner.embed
		await cached.embed("b");
		expect(inner.embed).toHaveBeenCalledTimes(6);
	});

	// ---------------------------------------------------------------
	// noEmbed: true — returns null without calling inner.embed
	// ---------------------------------------------------------------

	it("returns null without calling inner.embed when noEmbed is true", async () => {
		const inner = mockEmbedder();
		const cached = createCachedEmbedder(inner, { noEmbed: true });

		const result = await cached.embed("anything");

		expect(result).toBeNull();
		expect(inner.embed).not.toHaveBeenCalled();
	});

	// ---------------------------------------------------------------
	// paranoid: true + trustTier=4 — returns null
	// ---------------------------------------------------------------

	it("returns null without calling inner.embed when paranoid and trustTier is 4", async () => {
		const inner = mockEmbedder();
		const cached = createCachedEmbedder(inner, { paranoid: true });

		const result = await cached.embed("untrusted content", 4);

		expect(result).toBeNull();
		expect(inner.embed).not.toHaveBeenCalled();
	});

	// ---------------------------------------------------------------
	// paranoid: true + trustTier=1 — calls inner.embed normally
	// ---------------------------------------------------------------

	it("calls inner.embed normally when paranoid and trustTier is 1", async () => {
		const inner = mockEmbedder();
		const cached = createCachedEmbedder(inner, { paranoid: true });

		const result = await cached.embed("trusted content", 1);

		expect(result).toEqual(new Float32Array([1, 2, 3]));
		expect(inner.embed).toHaveBeenCalledTimes(1);
	});

	// ---------------------------------------------------------------
	// Model-name keying — same text, different model → separate entries
	// ---------------------------------------------------------------

	it("caches by model name — same text different model gets different entries", async () => {
		let callCount = 0;
		const modelAEmbedder = {
			modelName: "model-a",
			embeddingDim: 384,
			embed: async () => {
				callCount++;
				return new Float32Array(384).fill(callCount);
			},
			embedBatch: async (texts: string[]) => texts.map(() => new Float32Array(384)),
			close: () => {},
		};

		const cached = createCachedEmbedder(modelAEmbedder, { maxSize: 100 });

		// First call — cache miss
		await cached.embed("hello");
		expect(callCount).toBe(1);

		// Second call same text — cache hit
		await cached.embed("hello");
		expect(callCount).toBe(1); // Not incremented

		// Different model name — cache miss even for same text
		const modelBEmbedder = {
			modelName: "model-b",
			embeddingDim: 768,
			embed: async () => {
				callCount++;
				return new Float32Array(768).fill(callCount);
			},
			embedBatch: async (texts: string[]) => texts.map(() => new Float32Array(768)),
			close: () => {},
		};

		const cached2 = createCachedEmbedder(modelBEmbedder, { maxSize: 100 });
		await cached2.embed("hello");
		expect(callCount).toBe(2); // Different model, cache miss
	});

	// ---------------------------------------------------------------
	// close() delegates to inner.close()
	// ---------------------------------------------------------------

	it("delegates close() to the inner embedder", () => {
		const inner = mockEmbedder();
		const cached = createCachedEmbedder(inner);

		cached.close();

		expect(inner.close).toHaveBeenCalledTimes(1);
	});
});
