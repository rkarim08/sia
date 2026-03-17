import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LibSqlDb } from "@/graph/db-interface";

const mockCreateClient = vi.fn(() => ({
	execute: vi.fn(async () => ({ rows: [] })),
	batch: vi.fn(async () => {}),
	sync: vi.fn(async () => {}),
}));

vi.mock(
	"@libsql/client",
	() => {
		return {
			createClient: mockCreateClient,
		};
	},
	{ virtual: true },
);

vi.mock("@/sync/keychain", () => ({
	getToken: vi.fn(async (url: string) => {
		if (url === "https://ok") return "token";
		return null;
	}),
}));

describe("createSiaDb", () => {
	it("throws when sync disabled", async () => {
		const { createSiaDb } = await import("@/sync/client");
		await expect(
			createSiaDb("repo", {
				enabled: false,
				serverUrl: null,
				developerId: null,
				syncInterval: 30,
			}),
		).rejects.toThrow(/createSiaDb\(\) called without sync enabled/);
	});

	it("throws when token missing", async () => {
		const { createSiaDb } = await import("@/sync/client");
		await expect(
			createSiaDb("repo", {
				enabled: true,
				serverUrl: "https://missing",
				developerId: null,
				syncInterval: 30,
			}),
		).rejects.toThrow(/team join/);
	});

	it("returns LibSqlDb when sync enabled and token present", async () => {
		const { createSiaDb } = await import("@/sync/client");
		const home = mkdtempSync(join(tmpdir(), "sia-home-"));
		const db = await createSiaDb(
			"repo",
			{
				enabled: true,
				serverUrl: "https://ok",
				developerId: "dev-1",
				syncInterval: 15,
			},
			{ siaHome: home },
		);
		expect(db).toBeInstanceOf(LibSqlDb);
	});

	it("passes syncInterval through to createClient", async () => {
		mockCreateClient.mockClear();
		const { createSiaDb } = await import("@/sync/client");
		const home = mkdtempSync(join(tmpdir(), "sia-home-"));
		await createSiaDb(
			"repo",
			{
				enabled: true,
				serverUrl: "https://ok",
				developerId: "dev-1",
				syncInterval: 42,
			},
			{ siaHome: home },
		);
		expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({ syncInterval: 42 }));
	});
});
