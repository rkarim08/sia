import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("keychain fallback store", () => {
	it("stores, retrieves, and deletes tokens with file fallback", async () => {
		const home = mkdtempSync(join(tmpdir(), "sia-home-"));
		process.env.HOME = home;
		process.env.SIA_KEYCHAIN_FALLBACK = "1";
		vi.resetModules();

		const keychain = await import("@/sync/keychain");
		const serverUrl = "https://example.test";

		await keychain.storeToken(serverUrl, "secret-token");
		await expect(keychain.getToken(serverUrl)).resolves.toBe("secret-token");
		await keychain.deleteToken(serverUrl);
		await expect(keychain.getToken(serverUrl)).resolves.toBeNull();

		rmSync(home, { recursive: true, force: true });
	});
});
