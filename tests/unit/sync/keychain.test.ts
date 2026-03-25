import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
const originalHome = process.env.HOME;

// Mock @/shared/config so SIA_HOME reads $HOME dynamically at access time.
vi.mock("@/shared/config", () => ({
	get SIA_HOME() {
		const { homedir } = require("node:os");
		const { join } = require("node:path");
		return join(homedir(), ".sia");
	},
	resolveSiaHome: () => {
		const { homedir } = require("node:os");
		const { join } = require("node:path");
		return join(homedir(), ".sia");
	},
	getConfig: vi.fn().mockReturnValue({}),
}));

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "sia-home-"));
	process.env.HOME = tmpDir;
	process.env.SIA_KEYCHAIN_FALLBACK = "1";
});

afterEach(() => {
	process.env.HOME = originalHome;
	delete process.env.SIA_KEYCHAIN_FALLBACK;
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

describe("keychain fallback store", () => {
	it("stores, retrieves, and deletes tokens with file fallback", async () => {
		const keychain = await import("@/sync/keychain");
		const serverUrl = "https://example.test";

		await keychain.storeToken(serverUrl, "secret-token");
		await expect(keychain.getToken(serverUrl)).resolves.toBe("secret-token");
		await keychain.deleteToken(serverUrl);
		await expect(keychain.getToken(serverUrl)).resolves.toBeNull();
	});
});
