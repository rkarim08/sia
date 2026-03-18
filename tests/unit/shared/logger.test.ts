import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "@/shared/logger";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-logger-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("structured logger", () => {
	const tmpDirs: string[] = [];

	afterEach(() => {
		for (const dir of tmpDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tmpDirs.length = 0;
	});

	it("creates log directory if missing", () => {
		const tmpDir = makeTmp();
		tmpDirs.push(tmpDir);

		const logger = createLogger(tmpDir);
		logger.info("test", "op", "hello");

		expect(existsSync(join(tmpDir, "logs", "sia.log"))).toBe(true);
	});

	it("writes structured JSON log entries", () => {
		const tmpDir = makeTmp();
		tmpDirs.push(tmpDir);

		const logger = createLogger(tmpDir);
		logger.info("module", "operation", "message");

		const content = readFileSync(join(tmpDir, "logs", "sia.log"), "utf-8").trim();
		const entry = JSON.parse(content);

		expect(typeof entry.ts).toBe("number");
		expect(entry.level).toBe("info");
		expect(entry.module).toBe("module");
		expect(entry.op).toBe("operation");
		expect(entry.message).toBe("message");
	});

	it("error method includes error string", () => {
		const tmpDir = makeTmp();
		tmpDirs.push(tmpDir);

		const logger = createLogger(tmpDir);
		logger.error("mod", "op", "failed", new Error("boom"));

		const content = readFileSync(join(tmpDir, "logs", "sia.log"), "utf-8").trim();
		const entry = JSON.parse(content);

		expect(entry.error).toBe("boom");
	});

	it("appends multiple entries", () => {
		const tmpDir = makeTmp();
		tmpDirs.push(tmpDir);

		const logger = createLogger(tmpDir);
		logger.info("m", "o", "first");
		logger.warn("m", "o", "second");
		logger.error("m", "o", "third");

		const lines = readFileSync(join(tmpDir, "logs", "sia.log"), "utf-8")
			.trim()
			.split("\n");

		expect(lines).toHaveLength(3);
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});

	it("handles non-Error in error method", () => {
		const tmpDir = makeTmp();
		tmpDirs.push(tmpDir);

		const logger = createLogger(tmpDir);
		logger.error("mod", "op", "msg", "string-error");

		const content = readFileSync(join(tmpDir, "logs", "sia.log"), "utf-8").trim();
		const entry = JSON.parse(content);

		expect(entry.error).toBe("string-error");
	});
});
