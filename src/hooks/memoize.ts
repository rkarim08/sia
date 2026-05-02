// Module: memoize — Per-turn memoization for hook-layer retrieval
//
// Hooks may fire multiple times within a single user turn (e.g. a follow-up
// PreToolUse or a nested prompt). We do not want to re-run an expensive graph
// query for the same `(sessionId, promptHash)` pair inside the same turn.
//
// This helper provides a tiny in-process cache keyed by `sessionId` -> key
// -> value. Consumers derive the inner `key` however they like (typically a
// stable hash of the prompt text).
//
// Lifetime note: In current Claude Code plugin mode, each hook runs in a
// fresh process; the cache is effectively per-invocation. A future daemon
// mode (where one long-lived process serves many hook fires) would require
// a TTL or turn-keyed eviction to prevent cross-turn cache reuse within the
// same session. For now the store is intentionally un-bounded because each
// hook process typically exits in well under a second.
//
// For longer-lived callers (tests, future daemon mode), call `clearTurnMemo`
// to evict.

/** Two-level cache: `sessionId` -> `key` -> resolved value. */
export const turnMemo = new Map<string, Map<string, unknown>>();

/**
 * Run `compute` at most once per `(sessionId, key)`. Subsequent calls with
 * the same pair return the first call's resolved value.
 *
 * Rejected promises are NOT cached — a thrown error allows a retry on the
 * next call.
 */
export async function memoizeForTurn<T>(
	sessionId: string,
	key: string,
	compute: () => Promise<T>,
): Promise<T> {
	let bucket = turnMemo.get(sessionId);
	if (!bucket) {
		bucket = new Map<string, unknown>();
		turnMemo.set(sessionId, bucket);
	}

	if (bucket.has(key)) {
		return bucket.get(key) as T;
	}

	// Failures from compute() propagate without being cached — caller may retry next turn.
	const value = await compute();
	bucket.set(key, value);
	return value;
}

/**
 * Evict memoized entries for a given session (or the whole cache when no
 * session is supplied). Primarily intended for tests that share a process.
 */
export function clearTurnMemo(sessionId?: string): void {
	if (sessionId === undefined) {
		turnMemo.clear();
	} else {
		turnMemo.delete(sessionId);
	}
}
