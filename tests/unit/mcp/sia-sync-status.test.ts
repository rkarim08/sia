import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted mock fns so vi.mock factory can reference them
const { mockGetConfig, mockResolveSiaHome } = vi.hoisted(() => ({
	mockGetConfig: vi.fn(),
	mockResolveSiaHome: vi.fn().mockReturnValue("/tmp/sia-test"),
}));

vi.mock("@/shared/config", () => ({
	getConfig: mockGetConfig,
	resolveSiaHome: mockResolveSiaHome,
}));

import { handleSiaSyncStatus } from "@/mcp/tools/sia-sync-status";

afterEach(() => {
	vi.restoreAllMocks();
	mockGetConfig.mockReset();
	mockResolveSiaHome.mockReset().mockReturnValue("/tmp/sia-test");
});

describe("handleSiaSyncStatus", () => {
	it("should return sync disabled when not configured", async () => {
		mockGetConfig.mockReturnValue({
			sync: { enabled: false, serverUrl: null, developerId: null, syncInterval: 30 },
		});
		const result = await handleSiaSyncStatus();
		expect(result.enabled).toBe(false);
		expect(result.status).toBe("not_configured");
		expect(result.error).toBeUndefined();
	});

	it("should return the expected shape", async () => {
		mockGetConfig.mockReturnValue({
			sync: { enabled: false, serverUrl: null, developerId: null, syncInterval: 30 },
		});
		const result = await handleSiaSyncStatus();
		expect(result).toHaveProperty("enabled");
		expect(result).toHaveProperty("status");
		expect(["not_configured", "active", "error"]).toContain(result.status);
	});

	it("should return active status when sync is configured", async () => {
		mockGetConfig.mockReturnValue({
			sync: {
				enabled: true,
				serverUrl: "http://localhost:8080",
				developerId: "dev-123",
				syncInterval: 30,
			},
		});
		const result = await handleSiaSyncStatus();
		expect(result.enabled).toBe(true);
		expect(result.status).toBe("active");
		expect(result.server_url).toBe("http://localhost:8080");
		expect(result.developer_id).toBe("dev-123");
		expect(result.sync_interval_seconds).toBe(30);
	});

	it("should return error status when config throws", async () => {
		mockGetConfig.mockImplementation(() => {
			throw new Error("config file corrupt");
		});
		const result = await handleSiaSyncStatus();
		expect(result.enabled).toBe(false);
		expect(result.status).toBe("error");
		expect(result.error).toBe("config file corrupt");
	});

	it("omits next_steps on normal status", async () => {
		mockGetConfig.mockReturnValue({
			sync: { enabled: false, serverUrl: null, developerId: null, syncInterval: 30 },
		});
		const result = await handleSiaSyncStatus();
		expect(result.next_steps).toBeUndefined();
	});

	it("populates next_steps with sia_doctor on error status", async () => {
		mockGetConfig.mockImplementation(() => {
			throw new Error("boom");
		});
		const result = await handleSiaSyncStatus();
		expect(result.status).toBe("error");
		expect(result.next_steps?.length).toBeGreaterThan(0);
		expect(result.next_steps?.map((s) => s.tool)).toContain("sia_doctor");
	});
});
