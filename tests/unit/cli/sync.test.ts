import { afterEach, describe, expect, it, vi } from "vitest";

// ---- Hoisted mock fns (declared in hoisted scope so vi.mock factories can reference them) ----
const {
	mockPushChanges,
	mockPullChanges,
	mockCreateSiaDb,
	mockOpenBridgeDb,
	mockOpenMetaDb,
	mockResolveRepoHash,
	mockGetConfig,
	mockResolveSiaHome,
} = vi.hoisted(() => ({
	mockPushChanges: vi.fn().mockResolvedValue({
		entitiesPushed: 3,
		edgesPushed: 5,
		bridgeEdgesPushed: 0,
	}),
	mockPullChanges: vi.fn().mockResolvedValue({
		entitiesReceived: 2,
		edgesReceived: 4,
		vssRefreshed: 1,
	}),
	mockCreateSiaDb: vi.fn().mockResolvedValue({
		close: vi.fn().mockResolvedValue(undefined),
		execute: vi.fn(),
		query: vi.fn(),
		run: vi.fn(),
	}),
	mockOpenBridgeDb: vi.fn().mockReturnValue({
		close: vi.fn().mockResolvedValue(undefined),
		execute: vi.fn(),
	}),
	mockOpenMetaDb: vi.fn().mockReturnValue({
		close: vi.fn().mockResolvedValue(undefined),
		execute: vi.fn(),
	}),
	mockResolveRepoHash: vi.fn().mockReturnValue("abc123"),
	mockGetConfig: vi.fn(),
	mockResolveSiaHome: vi.fn().mockReturnValue("/tmp/sia-test"),
}));

// ---- vi.mock at top level ----
vi.mock("@/sync/push", () => ({ pushChanges: mockPushChanges }));
vi.mock("@/sync/pull", () => ({ pullChanges: mockPullChanges }));
vi.mock("@/sync/client", () => ({ createSiaDb: mockCreateSiaDb }));
vi.mock("@/graph/bridge-db", () => ({ openBridgeDb: mockOpenBridgeDb }));
vi.mock("@/graph/meta-db", () => ({ openMetaDb: mockOpenMetaDb }));
vi.mock("@/capture/hook", () => ({ resolveRepoHash: mockResolveRepoHash }));
vi.mock("@/shared/config", () => ({
	getConfig: mockGetConfig,
	resolveSiaHome: mockResolveSiaHome,
	SIA_HOME: "/tmp/sia-test",
}));

import { runSync } from "@/cli/commands/sync";
import { pullChanges } from "@/sync/pull";
import { pushChanges } from "@/sync/push";

// ---- Helpers to set config per test ----
function configEnabled() {
	mockGetConfig.mockReturnValue({
		sync: {
			enabled: true,
			serverUrl: "http://localhost:8080",
			developerId: "dev-1",
			syncInterval: 30,
		},
	});
}

function configDisabled() {
	mockGetConfig.mockReturnValue({
		sync: { enabled: false, serverUrl: null, developerId: null, syncInterval: 30 },
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	// Reset mock implementations to defaults
	mockPushChanges.mockReset().mockResolvedValue({
		entitiesPushed: 3,
		edgesPushed: 5,
		bridgeEdgesPushed: 0,
	});
	mockPullChanges.mockReset().mockResolvedValue({
		entitiesReceived: 2,
		edgesReceived: 4,
		vssRefreshed: 1,
	});
	mockCreateSiaDb.mockReset().mockResolvedValue({
		close: vi.fn().mockResolvedValue(undefined),
		execute: vi.fn(),
		query: vi.fn(),
		run: vi.fn(),
	});
	mockOpenBridgeDb.mockReset().mockReturnValue({
		close: vi.fn().mockResolvedValue(undefined),
		execute: vi.fn(),
	});
	mockOpenMetaDb.mockReset().mockReturnValue({
		close: vi.fn().mockResolvedValue(undefined),
		execute: vi.fn(),
	});
	mockResolveRepoHash.mockReset().mockReturnValue("abc123");
	mockGetConfig.mockReset();
	mockResolveSiaHome.mockReset().mockReturnValue("/tmp/sia-test");
});

describe("sia sync CLI", () => {
	it("should export runSync function", async () => {
		configEnabled();
		expect(runSync).toBeDefined();
		expect(typeof runSync).toBe("function");
	});

	it("should handle 'push' subcommand", async () => {
		configEnabled();
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
		configEnabled();
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
		configEnabled();
		// suppress stdout
		const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		await runSync([]);
		spy.mockRestore();
		expect(pushChanges).toHaveBeenCalled();
		expect(pullChanges).toHaveBeenCalled();
	});

	it("should output both push and pull summaries when no args given", async () => {
		configEnabled();
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
		configEnabled();
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit");
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(runSync(["bogus"])).rejects.toThrow("process.exit");
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown subcommand: bogus"));
	});

	it("should exit with error when sync is not configured", async () => {
		configDisabled();
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit");
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(runSync(["push"])).rejects.toThrow("process.exit");
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Sync not configured"));
	});

	it("should print actionable error when pushChanges fails", async () => {
		configEnabled();
		mockPushChanges.mockReset().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));
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
		configEnabled();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runSync(["--help"]);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: sia sync"));
	});
});
