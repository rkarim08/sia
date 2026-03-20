import { describe, expect, it } from "vitest";
import { handleSiaFetchAndIndex, isPrivateIp } from "@/mcp/tools/sia-fetch-and-index";

describe("isPrivateIp", () => {
	it("blocks localhost (127.0.0.1)", () => {
		expect(isPrivateIp("127.0.0.1")).toBe(true);
	});

	it("blocks private ranges (10.x, 172.16.x, 192.168.x)", () => {
		expect(isPrivateIp("10.0.0.1")).toBe(true);
		expect(isPrivateIp("10.255.255.255")).toBe(true);
		expect(isPrivateIp("172.16.0.1")).toBe(true);
		expect(isPrivateIp("172.31.255.255")).toBe(true);
		expect(isPrivateIp("192.168.0.1")).toBe(true);
		expect(isPrivateIp("192.168.255.255")).toBe(true);
	});

	it("allows public IPs (8.8.8.8)", () => {
		expect(isPrivateIp("8.8.8.8")).toBe(false);
		expect(isPrivateIp("1.1.1.1")).toBe(false);
		expect(isPrivateIp("142.250.80.46")).toBe(false);
	});

	it("blocks IPv4-mapped IPv6 addresses", () => {
		expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
		expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
		expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
	});
});

describe("handleSiaFetchAndIndex", () => {
	it("rejects file:// scheme with error containing 'HTTP'", async () => {
		const mockDb = {
			execute: async () => ({ rows: [] }),
			executeMany: async () => {},
			transaction: async (fn: (db: unknown) => Promise<void>) => fn(mockDb),
			close: async () => {},
			rawSqlite: () => null,
		};

		const mockEmbedder = {
			embed: async () => new Float32Array(384),
			close: () => {},
		};

		const result = await handleSiaFetchAndIndex(
			mockDb as unknown as import("@/graph/db-interface").SiaDb,
			{ url: "file:///etc/passwd" },
			mockEmbedder,
			"session-test",
		);

		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/HTTP/i);
	});
});
