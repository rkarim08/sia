// Module: hooks/preference-cache — session-level cache for active Tier-1 Preferences
//
// The preference-guard PreToolUse subscriber runs on every Bash|Write|Edit call, so
// hitting the graph on every invocation would be wasteful. This module caches the
// active Tier-1 Preference rows for a short TTL (default 30s). Any `nous_modify`
// write-path that mutates a Preference node should call `invalidatePreferenceCache`
// so the next read refreshes. Otherwise the TTL ensures stale entries drop out on
// their own, keeping the failure mode bounded.

import type { SiaDb } from "@/graph/db-interface";

/** Shape of a cached Preference row used by the guard. */
export interface Tier1Preference {
	id: string;
	name: string;
	content: string;
	summary: string;
}

interface CacheEntry {
	rows: Tier1Preference[];
	expires_at: number;
}

const DEFAULT_TTL_MS = 30_000;

// Module-level singleton cache. One entry per process — hook scripts exit after each
// event so this cache's lifetime matches a single invocation, but we still keep the
// structure for tests that invoke multiple reads in a loop.
let cache: CacheEntry | null = null;
let ttlMs = DEFAULT_TTL_MS;

/**
 * Return the active (t_valid_until IS NULL AND archived_at IS NULL) Tier-1
 * Preference rows. Uses a session-level cache with a short TTL. On DB error,
 * returns an empty array — the guard must fail open, never closed.
 */
export async function getActiveTier1Preferences(db: SiaDb): Promise<Tier1Preference[]> {
	const now = Date.now();
	if (cache && cache.expires_at > now) {
		return cache.rows;
	}

	try {
		const { rows } = await db.execute(
			`SELECT id, name, content, summary
			 FROM graph_nodes
			 WHERE kind = 'Preference'
			   AND trust_tier = 1
			   AND t_valid_until IS NULL
			   AND archived_at IS NULL`,
		);
		const typed = rows.map((r) => ({
			id: String(r.id),
			name: String(r.name ?? ""),
			content: String(r.content ?? ""),
			summary: String(r.summary ?? ""),
		}));
		cache = { rows: typed, expires_at: now + ttlMs };
		return typed;
	} catch (err) {
		process.stderr.write(`sia preference-cache read error: ${err}\n`);
		// Fail open: no preferences → no enforcement.
		cache = { rows: [], expires_at: now + ttlMs };
		return [];
	}
}

/**
 * Invalidate the cache. Call after any write that mutates Preference nodes
 * (e.g. `nous_modify`) so the next guard read refreshes immediately rather
 * than waiting up to 30s for the TTL.
 */
export function invalidatePreferenceCache(): void {
	cache = null;
}

/** Test-only: override the TTL. */
export function _setPreferenceCacheTtlForTests(newTtlMs: number): void {
	ttlMs = newTtlMs;
	cache = null;
}

/** Test-only: reset both TTL and cache to defaults. */
export function _resetPreferenceCacheForTests(): void {
	ttlMs = DEFAULT_TTL_MS;
	cache = null;
}
