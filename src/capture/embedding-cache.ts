// Module: embedding-cache — LRU-cached wrapper around an Embedder with noEmbed and paranoid modes

import { createHash } from "node:crypto";
import type { Embedder } from "@/capture/embedder";

/** Configuration options for the cached embedder. */
export interface CacheOpts {
	/** Maximum number of cache entries before LRU eviction kicks in. Default: 1000. */
	maxSize?: number;
	/** When true, embed() returns null immediately without loading the model. */
	noEmbed?: boolean;
	/** When true, embed() returns null for trustTier === 4 content. */
	paranoid?: boolean;
}

/** Compute a SHA-256 hex digest of the given text. */
function contentHash(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/**
 * Wrap an inner Embedder with LRU caching, noEmbed, and paranoid-mode support.
 *
 * - **LRU cache**: content-hash keyed (SHA-256 of text). Same text yields a
 *   cache hit with no ONNX call. When full the oldest entry is evicted.
 * - **noEmbed**: when `opts.noEmbed` is true, `embed()` returns null immediately.
 * - **paranoid**: when `opts.paranoid` is true AND `trustTier === 4`, `embed()`
 *   returns null immediately (Tier 4 content is never embedded).
 */
export function createCachedEmbedder(inner: Embedder, opts?: CacheOpts): Embedder {
	const maxSize = Math.max(1, opts?.maxSize ?? 1000);
	const noEmbed = opts?.noEmbed ?? false;
	const paranoid = opts?.paranoid ?? false;

	// Map preserves insertion order, which we exploit for LRU eviction.
	const cache = new Map<string, Float32Array | null>();

	return {
		async embed(text: string, trustTier?: number): Promise<Float32Array | null> {
			// --no-embed: short-circuit without touching model
			if (noEmbed) return null;

			// paranoid mode: block Tier 4 content
			if (paranoid && trustTier === 4) return null;

			const modelPrefix = (inner as { modelName?: string }).modelName ?? "default";
			const key = contentHash(`${modelPrefix}:${text}`);

			// Cache hit — move entry to end (most-recently-used)
			const cached = cache.get(key);
			if (cached !== undefined) {
				cache.delete(key);
				cache.set(key, cached);
				return cached;
			}

			// Cache miss — delegate to inner embedder
			const result = await inner.embed(text, trustTier);

			// Evict oldest entry if cache is full
			if (cache.size >= maxSize) {
				const oldest = cache.keys().next().value as string;
				cache.delete(oldest);
			}

			cache.set(key, result);
			return result;
		},

		async embedBatch(texts: string[]): Promise<(Float32Array | null)[]> {
			const results: (Float32Array | null)[] = [];
			for (let i = 0; i < texts.length; i += 16) {
				const batch = texts.slice(i, i + 16);
				const batchResults = await Promise.all(batch.map((t) => this.embed(t)));
				results.push(...batchResults);
			}
			return results;
		},

		close(): void {
			inner.close();
		},
	};
}
