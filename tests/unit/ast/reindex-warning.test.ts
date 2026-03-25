import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock indexRepository to return controlled results (0 entities, >0 files)
vi.mock("@/ast/indexer", () => ({
	indexRepository: vi.fn().mockResolvedValue({
		filesProcessed: 3,
		entitiesCreated: 0,
		edgesCreated: 0,
		cacheHits: 0,
		durationMs: 100,
		skippedFiles: [],
	}),
}));

vi.mock("@/graph/meta-db", () => ({
	openMetaDb: vi.fn().mockReturnValue({
		close: vi.fn(),
		execute: vi.fn().mockResolvedValue({ rows: [] }),
	}),
	registerRepo: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/workspace/detector", () => ({
	detectMonorepoPackages: vi.fn().mockResolvedValue([]),
	registerMonorepoPackages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/workspace/api-contracts", () => ({
	detectApiContracts: vi.fn().mockResolvedValue([]),
	writeDetectedContracts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/graph/semantic-db", () => ({
	openGraphDb: vi.fn().mockReturnValue({
		close: vi.fn(),
		execute: vi.fn().mockResolvedValue({ rows: [] }),
	}),
}));

vi.mock("@/shared/config", () => ({
	getConfig: vi.fn().mockReturnValue({
		airGapped: false,
		astCacheDir: "/tmp/ast-cache",
		excludePaths: [],
	}),
}));

// Import after mocks are set up (vi.mock is hoisted)
import { siaReindex } from "@/cli/commands/reindex";

describe("siaReindex warning", () => {
	let repoRoot: string;
	let siaHome: string;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "sia-reindex-warn-"));
		siaHome = mkdtempSync(join(tmpdir(), "sia-reindex-warn-home-"));
		mkdirSync(join(repoRoot, ".git"));
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
		rmSync(siaHome, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("prints warning when 0 entities created despite processing files", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const result = await siaReindex({ cwd: repoRoot, siaHome });

		expect(result.filesProcessed).toBe(3);
		expect(result.entitiesCreated).toBe(0);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Warning: 0 entities created despite processing files"),
		);

		logSpy.mockRestore();
		warnSpy.mockRestore();
	});
});
