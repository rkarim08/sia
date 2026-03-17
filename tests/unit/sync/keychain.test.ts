import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let tmpDir: string | undefined;
const originalHome = process.env.HOME;

afterEach(() => {
	process.env.HOME = originalHome;
	delete process.env.SIA_KEYCHAIN_FALLBACK;
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = undefined;
	}
});

describe("keychain fallback store", () => {
	it("stores, retrieves, and deletes tokens with file fallback", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "sia-home-"));
		process.env.HOME = tmpDir;
		process.env.SIA_KEYCHAIN_FALLBACK = "1";
		vi.resetModules();

		const keychain = await import("@/sync/keychain");
		const serverUrl = "https://example.test";

		await keychain.storeToken(serverUrl, "secret-token");
		await expect(keychain.getToken(serverUrl)).resolves.toBe("secret-token");
		await keychain.deleteToken(serverUrl);
		await expect(keychain.getToken(serverUrl)).resolves.toBeNull();
	});
});
