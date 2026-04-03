import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyModelChecksum } from "@/cli/commands/download-model";

describe("verifyModelChecksum", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `sia-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		import("node:fs").then(({ rmSync }) => {
			try {
				rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		});
	});

	it("should return true when hash matches file content", async () => {
		const filePath = join(tempDir, "test-file.bin");
		const content = "hello, sia model verification";
		writeFileSync(filePath, content);

		const expectedHash = createHash("sha256").update(content).digest("hex");

		const result = await verifyModelChecksum(filePath, expectedHash);
		expect(result).toBe(true);
		// File should still exist
		expect(existsSync(filePath)).toBe(true);
	});

	it("should return false and delete the file when hash does not match", async () => {
		const filePath = join(tempDir, "bad-model.bin");
		const content = "corrupted or wrong content";
		writeFileSync(filePath, content);

		const wrongHash = "0".repeat(64); // 64 zeros — definitely wrong

		const result = await verifyModelChecksum(filePath, wrongHash);
		expect(result).toBe(false);
		// File should be deleted after mismatch
		expect(existsSync(filePath)).toBe(false);
	});
});
