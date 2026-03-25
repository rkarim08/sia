import { afterEach, describe, expect, it, vi } from "vitest";

// Shared mock factories — each test gets fresh instances via vi.doMock + resetModules
function mockSyncModules() {
	vi.doMock("@/sync/push", () => ({
		pushChanges: vi.fn().mockResolvedValue({
			entitiesPushed: 3,
			edgesPushed: 5,
			bridgeEdgesPushed: 0,
		}),
	}));
	vi.doMock("@/sync/pull", () => ({
		pullChanges: vi.fn().mockResolvedValue({
			entitiesReceived: 2,
			edgesReceived: 4,
			vssRefreshed: 1,
		}),
	}));
	vi.doMock("@/sync/client", () => ({
		createSiaDb: vi.fn().mockResolvedValue({
			close: vi.fn().mockResolvedValue(undefined),
			execute: vi.fn(),
			query: vi.fn(),
			run: vi.fn(),
		}),
	}));
	vi.doMock("@/graph/bridge-db", () => ({
		openBridgeDb: vi.fn().mockReturnValue({
			close: vi.fn().mockResolvedValue(undefined),
			execute: vi.fn(),
		}),
	}));
	vi.doMock("@/graph/meta-db", () => ({
		openMetaDb: vi.fn().mockReturnValue({
			close: vi.fn().mockResolvedValue(undefined),
			execute: vi.fn(),
		}),
	}));
	vi.doMock("@/capture/hook", () => ({
		resolveRepoHash: vi.fn().mockReturnValue("abc123"),
	}));
}

function mockConfigEnabled() {
	vi.doMock("@/shared/config", () => ({
		getConfig: vi.fn().mockReturnValue({
			sync: {
				enabled: true,
				serverUrl: "http://localhost:8080",
				developerId: "dev-1",
				syncInterval: 30,
			},
		}),
		resolveSiaHome: vi.fn().mockReturnValue("/tmp/sia-test"),
		SIA_HOME: "/tmp/sia-test",
	}));
}

function mockConfigDisabled() {
	vi.doMock("@/shared/config", () => ({
		getConfig: vi.fn().mockReturnValue({
			sync: { enabled: false, serverUrl: null, developerId: null, syncInterval: 30 },
		}),
		resolveSiaHome: vi.fn().mockReturnValue("/tmp/sia-test"),
		SIA_HOME: "/tmp/sia-test",
	}));
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("sia sync CLI", () => {
	it("should export runSync function", async () => {
		mockSyncModules();
		mockConfigEnabled();
		const { runSync } = await import("@/cli/commands/sync");
		expect(runSync).toBeDefined();
		expect(typeof runSync).toBe("function");
	});

	it("should handle 'push' subcommand", async () => {
		mockSyncModules();
		mockConfigEnabled();
		const { runSync } = await import("@/cli/commands/sync");
		const output: string[] = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
			output.push(String(s));
			return true;
		});
		try {
			await runSync(["push"]);
		} finally {
			spy.mockRestore();
		}
		const text = output.join("");
		expect(text).toContain("Push:");
		expect(text).toContain("3 entities");
	});

	it("should handle 'pull' subcommand", async () => {
		mockSyncModules();
		mockConfigEnabled();
		const { runSync } = await import("@/cli/commands/sync");
		const output: string[] = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
			output.push(String(s));
			return true;
		});
		try {
			await runSync(["pull"]);
		} finally {
			spy.mockRestore();
		}
		const text = output.join("");
		expect(text).toContain("Pull:");
		expect(text).toContain("2 entities");
	});

	it("should push then pull when no args given", async () => {
		mockSyncModules();
		mockConfigEnabled();
		const { runSync } = await import("@/cli/commands/sync");
		const { pushChanges } = await import("@/sync/push");
		const { pullChanges } = await import("@/sync/pull");
		// suppress stdout
		const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		await runSync([]);
		spy.mockRestore();
		expect(pushChanges).toHaveBeenCalled();
		expect(pullChanges).toHaveBeenCalled();
	});

	it("should output both push and pull summaries when no args given", async () => {
		mockSyncModules();
		mockConfigEnabled();
		const { runSync } = await import("@/cli/commands/sync");
		const output: string[] = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
			output.push(String(s));
			return true;
		});
		try {
			await runSync([]);
		} finally {
			spy.mockRestore();
		}
		const text = output.join("");
		expect(text).toContain("Push:");
		expect(text).toContain("Pull:");
	});

	it("should exit with error for unknown subcommand", async () => {
		mockSyncModules();
		mockConfigEnabled();
		const { runSync } = await import("@/cli/commands/sync");
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit");
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(runSync(["bogus"])).rejects.toThrow("process.exit");
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown subcommand: bogus"));
	});

	it("should exit cleanly when sync is not configured", async () => {
		mockSyncModules();
		mockConfigDisabled();
		const { runSync } = await import("@/cli/commands/sync");
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit");
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(runSync(["push"])).rejects.toThrow("process.exit");
		expect(exitSpy).toHaveBeenCalledWith(0);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Sync not configured"));
	});

	it("should print actionable error when pushChanges fails", async () => {
		vi.doMock("@/sync/push", () => ({
			pushChanges: vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED")),
		}));
		vi.doMock("@/sync/pull", () => ({
			pullChanges: vi
				.fn()
				.mockResolvedValue({ entitiesReceived: 0, edgesReceived: 0, vssRefreshed: 0 }),
		}));
		vi.doMock("@/sync/client", () => ({
			createSiaDb: vi.fn().mockResolvedValue({
				close: vi.fn().mockResolvedValue(undefined),
			}),
		}));
		vi.doMock("@/graph/bridge-db", () => ({
			openBridgeDb: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
		}));
		vi.doMock("@/graph/meta-db", () => ({
			openMetaDb: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
		}));
		vi.doMock("@/capture/hook", () => ({
			resolveRepoHash: vi.fn().mockReturnValue("abc123"),
		}));
		mockConfigEnabled();
		const { runSync } = await import("@/cli/commands/sync");
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit");
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(runSync(["push"])).rejects.toThrow("process.exit");
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Sync failed: fetch failed: ECONNREFUSED"),
		);
	});

	it("should print help with --help flag", async () => {
		mockSyncModules();
		mockConfigEnabled();
		const { runSync } = await import("@/cli/commands/sync");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runSync(["--help"]);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: sia sync"));
	});
});
