import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("handleSiaSyncStatus", () => {
	it("should return sync disabled when not configured", async () => {
		const { handleSiaSyncStatus } = await import("@/mcp/tools/sia-sync-status");
		const result = await handleSiaSyncStatus();
		expect(result.enabled).toBe(false);
		expect(result.status).toBe("not_configured");
		expect(result.error).toBeUndefined();
	});

	it("should return the expected shape", async () => {
		const { handleSiaSyncStatus } = await import("@/mcp/tools/sia-sync-status");
		const result = await handleSiaSyncStatus();
		expect(result).toHaveProperty("enabled");
		expect(result).toHaveProperty("status");
		expect(["not_configured", "active", "error"]).toContain(result.status);
	});

	it("should return active status when sync is configured", async () => {
		vi.doMock("@/shared/config", () => ({
			getConfig: vi.fn().mockReturnValue({
				sync: {
					enabled: true,
					serverUrl: "http://localhost:8080",
					developerId: "dev-123",
					syncInterval: 30,
				},
			}),
			resolveSiaHome: vi.fn().mockReturnValue("/tmp/sia-test"),
		}));
		const { handleSiaSyncStatus } = await import("@/mcp/tools/sia-sync-status");
		const result = await handleSiaSyncStatus();
		expect(result.enabled).toBe(true);
		expect(result.status).toBe("active");
		expect(result.server_url).toBe("http://localhost:8080");
		expect(result.developer_id).toBe("dev-123");
		expect(result.sync_interval_seconds).toBe(30);
	});

	it("should return error status when config throws", async () => {
		vi.doMock("@/shared/config", () => ({
			getConfig: vi.fn().mockImplementation(() => {
				throw new Error("config file corrupt");
			}),
			resolveSiaHome: vi.fn().mockReturnValue("/tmp/sia-test"),
		}));
		const { handleSiaSyncStatus } = await import("@/mcp/tools/sia-sync-status");
		const result = await handleSiaSyncStatus();
		expect(result.enabled).toBe(false);
		expect(result.status).toBe("error");
		expect(result.error).toBe("config file corrupt");
	});
});
