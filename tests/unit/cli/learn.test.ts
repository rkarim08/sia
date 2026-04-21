import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock all dependencies before import
vi.mock("@/cli/commands/install", () => ({
	siaInstall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/cli/commands/reindex", () => ({
	siaReindex: vi.fn().mockResolvedValue({
		filesProcessed: 10,
		entitiesCreated: 20,
		cacheHits: 5,
		durationMs: 1000,
		repoHash: "test-hash",
		dryRun: false,
		packagesDetected: 0,
		contractsDetected: 0,
		packagePathBackfilled: 0,
	}),
}));

vi.mock("@/knowledge/discovery", () => ({
	discoverDocFiles: vi.fn().mockReturnValue([
		{
			absolutePath: "/tmp/test/README.md",
			relativePath: "README.md",
			pattern: { tag: "project-docs", trustTier: 1, priority: 3 },
			packagePath: null,
		},
	]),
}));

vi.mock("@/knowledge/ingest", () => ({
	ingestDocument: vi.fn().mockResolvedValue({
		fileNodeId: "node-1",
		chunksCreated: 3,
		edgesCreated: 3,
	}),
}));

vi.mock("@/knowledge/external-refs", () => ({
	detectExternalRefs: vi
		.fn()
		.mockReturnValue([{ url: "https://notion.so/page", service: "notion", lineNumber: 5 }]),
}));

vi.mock("@/community/leiden", () => ({
	detectCommunities: vi.fn().mockResolvedValue({
		levels: [3, 1],
		totalCommunities: 4,
		durationMs: 100,
	}),
}));

vi.mock("@/community/summarize", () => ({
	summarizeCommunities: vi.fn().mockResolvedValue(4),
}));

vi.mock("@/shared/config", () => ({
	getConfig: vi.fn().mockReturnValue({
		airGapped: false,
		astCacheDir: "/tmp/ast-cache",
		excludePaths: [],
	}),
	resolveSiaHome: vi.fn().mockReturnValue("/tmp/sia-test"),
	SIA_HOME: "/tmp/sia-test",
}));

vi.mock("@/capture/hook", () => ({
	resolveRepoHash: vi.fn().mockReturnValue("test-hash"),
}));

vi.mock("@/graph/semantic-db", () => ({
	openGraphDb: vi.fn().mockReturnValue({
		close: vi.fn(),
		execute: vi.fn().mockResolvedValue({ rows: [] }),
		query: vi.fn().mockReturnValue([]),
		run: vi.fn(),
		transaction: vi.fn(),
	}),
}));

import { siaLearn } from "@/cli/commands/learn";

describe("siaLearn orchestrator", () => {
	let tmpDir: string;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		// Create a .git dir so install can find repo root
		mkdirSync(join(dir, ".git"), { recursive: true });
		return dir;
	}

	afterEach(() => {
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should run all phases in order", async () => {
		tmpDir = makeTmp();
		writeFileSync(join(tmpDir, "README.md"), "# Test\nHello world");

		const result = await siaLearn({ cwd: tmpDir, verbosity: "quiet" });
		expect(result).toBeDefined();
		expect(result?.phasesCompleted).toContain(0);
		expect(result?.phasesCompleted).toContain(1);
		expect(result?.phasesCompleted).toContain(2);
		expect(result?.phasesCompleted).toContain(3);
	});

	it("should call siaInstall in phase 0", async () => {
		tmpDir = makeTmp();
		const { siaInstall } = await import("@/cli/commands/install");
		await siaLearn({ cwd: tmpDir, verbosity: "quiet" });
		expect(siaInstall).toHaveBeenCalled();
	});

	it("should call siaReindex in phase 1", async () => {
		tmpDir = makeTmp();
		const { siaReindex } = await import("@/cli/commands/reindex");
		await siaLearn({ cwd: tmpDir, verbosity: "quiet" });
		expect(siaReindex).toHaveBeenCalled();
	});

	it("should call discoverDocFiles + ingestDocument in phase 2", async () => {
		tmpDir = makeTmp();
		const { discoverDocFiles } = await import("@/knowledge/discovery");
		const { ingestDocument } = await import("@/knowledge/ingest");
		await siaLearn({ cwd: tmpDir, verbosity: "quiet" });
		expect(discoverDocFiles).toHaveBeenCalled();
		expect(ingestDocument).toHaveBeenCalled();
	});

	it("should call detectCommunities in phase 3", async () => {
		tmpDir = makeTmp();
		const { detectCommunities } = await import("@/community/leiden");
		await siaLearn({ cwd: tmpDir, verbosity: "quiet" });
		expect(detectCommunities).toHaveBeenCalled();
	});

	it("should delete progress file on success", async () => {
		tmpDir = makeTmp();
		await siaLearn({ cwd: tmpDir, verbosity: "quiet" });
		const progressPath = join(tmpDir, ".sia-learn-progress.json");
		expect(existsSync(progressPath)).toBe(false);
	});
});
