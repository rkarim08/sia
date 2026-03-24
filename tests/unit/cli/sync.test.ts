import { describe, expect, it, vi } from "vitest";

// Mock the sync modules before importing
vi.mock("@/sync/push", () => ({
	pushChanges: vi.fn().mockResolvedValue({
		entitiesPushed: 3,
		edgesPushed: 5,
		bridgeEdgesPushed: 0,
	}),
}));

vi.mock("@/sync/pull", () => ({
	pullChanges: vi.fn().mockResolvedValue({
		entitiesReceived: 2,
		edgesReceived: 4,
		vssRefreshed: 1,
	}),
}));

vi.mock("@/sync/client", () => ({
	createSiaDb: vi.fn().mockResolvedValue({
		close: vi.fn(),
		execute: vi.fn(),
		query: vi.fn(),
		run: vi.fn(),
	}),
}));

vi.mock("@/graph/bridge-db", () => ({
	openBridgeDb: vi.fn().mockReturnValue({
		close: vi.fn().mockResolvedValue(undefined),
		execute: vi.fn(),
	}),
}));

vi.mock("@/graph/meta-db", () => ({
	openMetaDb: vi.fn().mockReturnValue({
		close: vi.fn().mockResolvedValue(undefined),
		execute: vi.fn(),
	}),
}));

vi.mock("@/shared/config", () => ({
	getConfig: vi.fn().mockReturnValue({
		sync: { enabled: true, serverUrl: "http://localhost:8080", developerId: "dev-1", syncInterval: 30 },
	}),
	resolveSiaHome: vi.fn().mockReturnValue("/tmp/sia-test"),
	SIA_HOME: "/tmp/sia-test",
}));

vi.mock("@/capture/hook", () => ({
	resolveRepoHash: vi.fn().mockReturnValue("abc123"),
}));

import { runSync } from "@/cli/commands/sync";

describe("sia sync CLI", () => {
	it("should export runSync function", () => {
		expect(runSync).toBeDefined();
		expect(typeof runSync).toBe("function");
	});

	it("should handle 'push' subcommand", async () => {
		const output: string[] = [];
		const origWrite = process.stdout.write;
		process.stdout.write = ((s: string) => { output.push(s); return true; }) as any;
		try {
			await runSync(["push"]);
		} finally {
			process.stdout.write = origWrite;
		}
		const text = output.join("");
		expect(text).toContain("Push:");
		expect(text).toContain("3 entities");
	});

	it("should handle 'pull' subcommand", async () => {
		const output: string[] = [];
		const origWrite = process.stdout.write;
		process.stdout.write = ((s: string) => { output.push(s); return true; }) as any;
		try {
			await runSync(["pull"]);
		} finally {
			process.stdout.write = origWrite;
		}
		const text = output.join("");
		expect(text).toContain("Pull:");
		expect(text).toContain("2 entities");
	});

	it("should push then pull when no args given", async () => {
		const { pushChanges } = await import("@/sync/push");
		const { pullChanges } = await import("@/sync/pull");
		await runSync([]);
		expect(pushChanges).toHaveBeenCalled();
		expect(pullChanges).toHaveBeenCalled();
	});
});
