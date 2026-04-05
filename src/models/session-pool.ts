import type { OnnxSession } from "@/models/types";
export type { OnnxSession };

/** Factory function to create an ONNX session. */
export type SessionFactory = () => Promise<OnnxSession>;

/** Options for registering a model in the pool. */
export interface RegisterOptions {
	/** If true, this session is never evicted. Used for T0 models. */
	pinned?: boolean;
}

/** Session pool interface. */
export interface SessionPool {
	register(modelName: string, factory: SessionFactory, opts?: RegisterOptions): void;
	getSession(modelName: string): Promise<OnnxSession | null>;
	evictModel(modelName: string): void;
	closeAll(): Promise<void>;
	getActiveCount(): number;
}

interface PoolEntry {
	factory: SessionFactory;
	session: OnnxSession | null;
	loading: Promise<OnnxSession | null> | null;
	pinned: boolean;
	lastAccessed: number;
}

/**
 * Create an ONNX session pool with lazy loading and LRU eviction.
 *
 * - Models are registered with a factory function that creates the session on demand.
 * - Sessions are created lazily on first getSession() call.
 * - When the pool exceeds maxSessions, the least-recently-used non-pinned session is evicted.
 * - Pinned sessions (T0 models) are never evicted.
 */
export function createSessionPool(config: { maxSessions: number }): SessionPool {
	const entries = new Map<string, PoolEntry>();

	function evictIfNeeded(): void {
		const activeCount = [...entries.values()].filter((e) => e.session !== null).length;
		if (activeCount < config.maxSessions) return;

		// Find LRU non-pinned entry
		let lruName: string | null = null;
		let lruTime = Infinity;

		for (const [name, entry] of entries) {
			if (entry.pinned || entry.session === null) continue;
			if (entry.lastAccessed < lruTime) {
				lruTime = entry.lastAccessed;
				lruName = name;
			}
		}

		if (lruName) {
			const entry = entries.get(lruName)!;
			if (entry.session?.release) {
				entry.session.release();
			}
			entry.session = null;
		}
	}

	return {
		register(modelName: string, factory: SessionFactory, opts?: RegisterOptions): void {
			entries.set(modelName, {
				factory,
				session: null,
				loading: null,
				pinned: opts?.pinned ?? false,
				lastAccessed: 0,
			});
		},

		async getSession(modelName: string): Promise<OnnxSession | null> {
			const entry = entries.get(modelName);
			if (!entry) return null;

			if (entry.session === null) {
				// Deduplicate concurrent getSession calls for the same model
				if (entry.loading) {
					return entry.loading;
				}
				evictIfNeeded();
				const activeAfterEvict = [...entries.values()].filter((e) => e.session !== null).length;
				if (activeAfterEvict >= config.maxSessions && !entry.pinned) {
					console.warn(`[sia] session-pool: all ${config.maxSessions} sessions are pinned — cannot load ${modelName}`);
					return null;
				}
				entry.loading = (async () => {
					try {
						entry.session = await entry.factory();
						return entry.session;
					} catch (err) {
						console.error(
							`[sia] session-pool: failed to create session for ${modelName}:`,
							err instanceof Error ? err.message : String(err),
						);
						return null;
					} finally {
						entry.loading = null;
					}
				})();
				const result = await entry.loading;
				if (!result) return null;
			}

			entry.lastAccessed = Date.now();
			return entry.session;
		},

		evictModel(modelName: string): void {
			const entry = entries.get(modelName);
			if (!entry) return;
			if (entry.session?.release) {
				entry.session.release();
			}
			entries.delete(modelName);
		},

		async closeAll(): Promise<void> {
			for (const entry of entries.values()) {
				if (entry.session?.release) {
					entry.session.release();
				}
				entry.session = null;
			}
		},

		getActiveCount(): number {
			return [...entries.values()].filter((e) => e.session !== null).length;
		},
	};
}
