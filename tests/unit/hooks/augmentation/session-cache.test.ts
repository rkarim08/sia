import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionCache } from "@/hooks/augmentation/session-cache";

describe("hooks/augmentation/session-cache", () => {
	let tmpDir: string;
	let cachePath: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `sia-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tmpDir, { recursive: true });
		cachePath = join(tmpDir, "augment-cache.json");
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// ---------------------------------------------------------------
	// Fresh cache: hasAugmented returns false
	// ---------------------------------------------------------------
	it("returns false for a pattern that has not been augmented", () => {
		const cache = new SessionCache(cachePath);
		expect(cache.hasAugmented("handleAuth")).toBe(false);
	});

	// ---------------------------------------------------------------
	// markAugmented then hasAugmented returns true
	// ---------------------------------------------------------------
	it("returns true after marking a pattern as augmented", () => {
		const cache = new SessionCache(cachePath);
		cache.markAugmented("handleAuth");
		expect(cache.hasAugmented("handleAuth")).toBe(true);
	});

	// ---------------------------------------------------------------
	// Different patterns are independent
	// ---------------------------------------------------------------
	it("tracks patterns independently", () => {
		const cache = new SessionCache(cachePath);
		cache.markAugmented("handleAuth");
		expect(cache.hasAugmented("handleAuth")).toBe(true);
		expect(cache.hasAugmented("parseConfig")).toBe(false);
	});

	// ---------------------------------------------------------------
	// Persistence: data survives re-instantiation
	// ---------------------------------------------------------------
	it("persists data across instances", () => {
		const cache1 = new SessionCache(cachePath);
		cache1.markAugmented("handleAuth");

		const cache2 = new SessionCache(cachePath);
		expect(cache2.hasAugmented("handleAuth")).toBe(true);
	});

	// ---------------------------------------------------------------
	// Stale session: cache clears if session_start is older than 1 hour
	// ---------------------------------------------------------------
	it("clears cache if session_start is older than 1 hour", () => {
		// Write a cache file with a stale session_start
		const staleData = {
			augmented: ["handleAuth"],
			session_start: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
		};
		writeFileSync(cachePath, JSON.stringify(staleData));

		const cache = new SessionCache(cachePath);
		expect(cache.hasAugmented("handleAuth")).toBe(false);
	});

	// ---------------------------------------------------------------
	// Fresh session within 1 hour is preserved
	// ---------------------------------------------------------------
	it("preserves cache if session_start is within 1 hour", () => {
		const freshData = {
			augmented: ["handleAuth"],
			session_start: Date.now() - 30 * 60 * 1000, // 30 minutes ago
		};
		writeFileSync(cachePath, JSON.stringify(freshData));

		const cache = new SessionCache(cachePath);
		expect(cache.hasAugmented("handleAuth")).toBe(true);
	});

	// ---------------------------------------------------------------
	// Handles missing cache file gracefully
	// ---------------------------------------------------------------
	it("handles missing cache file gracefully", () => {
		const cache = new SessionCache(join(tmpDir, "nonexistent", "cache.json"));
		expect(cache.hasAugmented("anything")).toBe(false);
	});

	// ---------------------------------------------------------------
	// Handles corrupt cache file gracefully
	// ---------------------------------------------------------------
	it("handles corrupt cache file gracefully", () => {
		writeFileSync(cachePath, "not valid json{{{");
		const cache = new SessionCache(cachePath);
		expect(cache.hasAugmented("anything")).toBe(false);
	});
});
