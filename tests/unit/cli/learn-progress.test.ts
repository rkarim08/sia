import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
	type LearnProgress,
	readProgress,
	writeProgress,
	deleteProgress,
	runWithRetry,
} from "@/cli/learn-progress";

describe("learn-progress", () => {
	let tmpDir: string;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(() => {
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("readProgress", () => {
		it("should return null when no progress file exists", () => {
			tmpDir = makeTmp();
			const result = readProgress(tmpDir);
			expect(result).toBeNull();
		});

		it("should read a valid progress file", () => {
			tmpDir = makeTmp();
			const progress: LearnProgress = {
				started_at: Date.now(),
				repo_hash: "abc123",
				branch: "main",
				phases_completed: [0, 1],
				files_indexed: 500,
				total_files: 1000,
				last_checkpoint_at: Date.now(),
			};
			writeFileSync(
				join(tmpDir, ".sia-learn-progress.json"),
				JSON.stringify(progress),
			);
			const result = readProgress(tmpDir);
			expect(result).not.toBeNull();
			expect(result!.repo_hash).toBe("abc123");
			expect(result!.phases_completed).toEqual([0, 1]);
		});
	});

	describe("writeProgress", () => {
		it("should write a progress file", () => {
			tmpDir = makeTmp();
			const progress: LearnProgress = {
				started_at: Date.now(),
				repo_hash: "abc123",
				branch: "main",
				phases_completed: [0],
				files_indexed: 100,
				total_files: 500,
				last_checkpoint_at: Date.now(),
			};
			writeProgress(tmpDir, progress);
			const raw = readFileSync(join(tmpDir, ".sia-learn-progress.json"), "utf-8");
			const parsed = JSON.parse(raw);
			expect(parsed.repo_hash).toBe("abc123");
		});
	});

	describe("deleteProgress", () => {
		it("should delete the progress file", () => {
			tmpDir = makeTmp();
			writeFileSync(join(tmpDir, ".sia-learn-progress.json"), "{}");
			deleteProgress(tmpDir);
			expect(readProgress(tmpDir)).toBeNull();
		});

		it("should not throw if file doesn't exist", () => {
			tmpDir = makeTmp();
			expect(() => deleteProgress(tmpDir)).not.toThrow();
		});
	});

	describe("runWithRetry", () => {
		it("should return result on first success", async () => {
			const result = await runWithRetry("test", async () => 42, 3);
			expect(result).toBe(42);
		});

		it("should retry on failure and succeed", async () => {
			let attempts = 0;
			const result = await runWithRetry(
				"test",
				async () => {
					attempts++;
					if (attempts < 3) throw new Error("transient");
					return "ok";
				},
				3,
				10, // short backoff for test
			);
			expect(result).toBe("ok");
			expect(attempts).toBe(3);
		});

		it("should return null after max retries", async () => {
			const result = await runWithRetry(
				"test",
				async () => {
					throw new Error("permanent");
				},
				2,
				10, // short backoff for test
			);
			expect(result).toBeNull();
		});
	});
});
