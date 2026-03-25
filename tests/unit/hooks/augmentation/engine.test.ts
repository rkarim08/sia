import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the bm25-search module
vi.mock("@/retrieval/bm25-search", () => ({
	bm25Search: vi.fn(),
	sanitizeFts5Query: vi.fn((q: string) => q),
}));

// Mock the graph/semantic-db module
vi.mock("@/graph/semantic-db", () => ({
	openGraphDb: vi.fn(),
}));

// Mock the capture/hook module for resolveRepoHash
vi.mock("@/capture/hook", () => ({
	resolveRepoHash: vi.fn(() => "test-repo-hash"),
}));

import { openGraphDb } from "@/graph/semantic-db";
import { augment } from "@/hooks/augmentation/engine";
import { bm25Search } from "@/retrieval/bm25-search";

describe("hooks/augmentation/engine", () => {
	let tmpDir: string;
	let siaGraphDir: string;

	// Mock DB that returns empty results by default
	const mockDb = {
		execute: vi.fn().mockResolvedValue({ rows: [] }),
		executeMany: vi.fn(),
		transaction: vi.fn(),
		close: vi.fn().mockResolvedValue(undefined),
		rawSqlite: vi.fn(() => null),
	};

	beforeEach(() => {
		tmpDir = join(tmpdir(), `sia-engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		siaGraphDir = join(tmpDir, ".sia-graph");
		mkdirSync(siaGraphDir, { recursive: true });

		vi.clearAllMocks();
		(openGraphDb as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
		(bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// ---------------------------------------------------------------
	// Empty graph: returns empty string
	// ---------------------------------------------------------------
	it("returns empty string when BM25 search yields no results", async () => {
		(bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

		const result = await augment("handleAuth", siaGraphDir);
		expect(result).toBe("");
	});

	// ---------------------------------------------------------------
	// Known entity: returns formatted context
	// ---------------------------------------------------------------
	it("returns formatted context for a known entity", async () => {
		(bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([{ entityId: "e1", score: 0.9 }]);

		// Mock entity lookup
		mockDb.execute
			.mockResolvedValueOnce({
				rows: [
					{
						id: "e1",
						name: "handleAuth",
						type: "CodeEntity",
						file_paths: '["src/auth.ts"]',
						trust_tier: 2,
						summary: "Handles authentication",
					},
				],
			})
			// Mock edge lookup
			.mockResolvedValueOnce({
				rows: [{ target_name: "validateToken", type: "calls" }],
			});

		const result = await augment("handleAuth", siaGraphDir);
		expect(result).toContain("[SIA: handleAuth]");
		expect(result).toContain("handleAuth");
		expect(result).toContain("src/auth.ts");
	});

	// ---------------------------------------------------------------
	// Lockfile guard: skip if indexing.lock exists
	// ---------------------------------------------------------------
	it("returns empty string when indexing.lock exists", async () => {
		writeFileSync(join(siaGraphDir, "indexing.lock"), "locked");

		const result = await augment("handleAuth", siaGraphDir);
		expect(result).toBe("");
		expect(bm25Search).not.toHaveBeenCalled();
	});

	// ---------------------------------------------------------------
	// Disabled flag: skip if augment-enabled is false
	// ---------------------------------------------------------------
	it("returns empty string when augment-enabled is false", async () => {
		writeFileSync(join(siaGraphDir, "augment-enabled"), "false");

		const result = await augment("handleAuth", siaGraphDir);
		expect(result).toBe("");
		expect(bm25Search).not.toHaveBeenCalled();
	});

	// ---------------------------------------------------------------
	// Enabled by default (no augment-enabled file)
	// ---------------------------------------------------------------
	it("is enabled by default when augment-enabled file does not exist", async () => {
		(bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

		const _result = await augment("handleAuth", siaGraphDir);
		// Should have proceeded to search (even though results are empty)
		expect(bm25Search).toHaveBeenCalled();
	});

	// ---------------------------------------------------------------
	// Dedup: same pattern is not augmented twice
	// ---------------------------------------------------------------
	it("skips augmentation for already-augmented pattern", async () => {
		(bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

		// First call
		await augment("handleAuth", siaGraphDir);
		expect(bm25Search).toHaveBeenCalledTimes(1);

		// Second call with same pattern — should be deduped
		const result = await augment("handleAuth", siaGraphDir);
		expect(result).toBe("");
		expect(bm25Search).toHaveBeenCalledTimes(1); // still 1
	});

	// ---------------------------------------------------------------
	// Closes DB after use
	// ---------------------------------------------------------------
	it("closes the database after use", async () => {
		(bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

		await augment("handleAuth", siaGraphDir);
		expect(mockDb.close).toHaveBeenCalled();
	});
});
