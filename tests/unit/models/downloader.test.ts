import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeFileSha256, downloadFile } from "@/models/downloader";

describe("model downloader", () => {
	let tmpDir: string;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-dl-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(() => {
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("computeFileSha256 returns correct hash for known content", async () => {
		tmpDir = makeTmp();
		const filePath = join(tmpDir, "test.txt");
		const { writeFileSync } = require("node:fs");
		writeFileSync(filePath, "hello world");

		const hash = await computeFileSha256(filePath);
		// SHA-256 of "hello world"
		expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
	});

	it("computeFileSha256 throws for nonexistent file", async () => {
		await expect(computeFileSha256("/nonexistent/file")).rejects.toThrow();
	});

	it("downloadFile downloads a small file and verifies checksum", { timeout: 30_000 }, async () => {
		tmpDir = makeTmp();
		const destPath = join(tmpDir, "downloaded.txt");

		// Use a tiny known file from HuggingFace (config.json is typically < 1KB)
		// Skip this test in CI — it requires network access
		if (process.env.CI) return;

		const url = "https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/main/config.json";
		await downloadFile(url, destPath);

		expect(existsSync(destPath)).toBe(true);
		const content = readFileSync(destPath, "utf-8");
		const parsed = JSON.parse(content);
		expect(parsed.hidden_size).toBe(384);
	});
});
