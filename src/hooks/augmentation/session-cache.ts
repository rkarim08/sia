// Module: session-cache — File-based JSON dedup cache for augmentation patterns

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Maximum session age in milliseconds (1 hour). */
const MAX_SESSION_AGE_MS = 60 * 60 * 1000;

/** Shape of the persisted cache file. */
interface CacheData {
	augmented: string[];
	session_start: number;
}

/**
 * Tracks which patterns have been augmented in the current session.
 *
 * Persists to a JSON file at the given path. Automatically clears
 * the cache if the session_start timestamp is older than 1 hour.
 */
export class SessionCache {
	private data: CacheData;

	constructor(private cachePath: string) {
		this.data = this.load();
	}

	/** Returns true if the pattern has already been augmented this session. */
	hasAugmented(pattern: string): boolean {
		return this.data.augmented.includes(pattern);
	}

	/** Mark a pattern as augmented and persist to disk. */
	markAugmented(pattern: string): void {
		if (!this.data.augmented.includes(pattern)) {
			this.data.augmented.push(pattern);
			this.save();
		}
	}

	/** Load cache from disk, resetting if stale or corrupt. */
	private load(): CacheData {
		try {
			if (!existsSync(this.cachePath)) {
				return this.freshCache();
			}

			const raw = readFileSync(this.cachePath, "utf-8");
			const parsed = JSON.parse(raw) as CacheData;

			// Validate structure
			if (!parsed || typeof parsed.session_start !== "number" || !Array.isArray(parsed.augmented)) {
				return this.freshCache();
			}

			// Check staleness
			if (Date.now() - parsed.session_start > MAX_SESSION_AGE_MS) {
				return this.freshCache();
			}

			return parsed;
		} catch {
			return this.freshCache();
		}
	}

	/** Create a fresh cache with the current timestamp. */
	private freshCache(): CacheData {
		return {
			augmented: [],
			session_start: Date.now(),
		};
	}

	/** Persist cache data to disk. */
	private save(): void {
		try {
			const dir = dirname(this.cachePath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			writeFileSync(this.cachePath, JSON.stringify(this.data));
		} catch {
			// Silently fail on write errors — cache is best-effort
		}
	}
}
