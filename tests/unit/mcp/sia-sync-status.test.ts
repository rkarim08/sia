import { describe, expect, it } from "vitest";
import { handleSiaSyncStatus } from "@/mcp/tools/sia-sync-status";

describe("handleSiaSyncStatus", () => {
	it("should return sync disabled when not configured", async () => {
		const result = await handleSiaSyncStatus();
		expect(result.enabled).toBe(false);
		expect(result.status).toBe("not_configured");
		expect(result.error).toBeUndefined();
	});

	it("should return the expected shape", async () => {
		const result = await handleSiaSyncStatus();
		expect(result).toHaveProperty("enabled");
		expect(result).toHaveProperty("status");
		expect(["not_configured", "active", "error"]).toContain(result.status);
	});
});
