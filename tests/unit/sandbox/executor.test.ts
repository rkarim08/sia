import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { detectLanguage, executeSubprocess } from "@/sandbox/executor";

const hasGcc = spawnSync("gcc", ["--version"], { timeout: 3000 }).status === 0;
const hasGpp = spawnSync("g++", ["--version"], { timeout: 3000 }).status === 0;

describe("executeSubprocess", () => {
	it("executes a bash script and captures stdout", async () => {
		const result = await executeSubprocess({
			language: "bash",
			code: 'echo "hello from bash"',
			timeout: 5000,
		});
		expect(result.stdout.trim()).toBe("hello from bash");
		expect(result.exitCode).toBe(0);
		expect(result.timedOut).toBe(false);
	});

	it("captures stderr separately", async () => {
		const result = await executeSubprocess({
			language: "bash",
			code: 'echo "out" && echo "err" >&2',
			timeout: 5000,
		});
		expect(result.stdout.trim()).toBe("out");
		expect(result.stderr.trim()).toBe("err");
	});

	it("times out and kills subprocess", async () => {
		const result = await executeSubprocess({
			language: "bash",
			code: "sleep 30",
			timeout: 500,
		});
		expect(result.timedOut).toBe(true);
	});

	it("truncates output at outputMaxBytes", async () => {
		const result = await executeSubprocess({
			language: "bash",
			code: 'printf "x%.0s" {1..2000}',
			timeout: 5000,
			outputMaxBytes: 1024,
		});
		expect(result.stdout.length).toBeLessThanOrEqual(1024);
		expect(result.truncated).toBe(true);
	});

	it("tracks runtimeMs", async () => {
		const result = await executeSubprocess({
			language: "bash",
			code: "sleep 0.1",
			timeout: 5000,
		});
		expect(result.runtimeMs).toBeGreaterThanOrEqual(50);
	});

	it("passes custom env vars", async () => {
		const result = await executeSubprocess({
			language: "bash",
			code: 'echo "$MY_VAR"',
			timeout: 5000,
			env: { MY_VAR: "test_value", PATH: process.env.PATH ?? "/usr/bin:/bin" },
		});
		expect(result.stdout.trim()).toBe("test_value");
	});

	it("throws on unsupported language", async () => {
		await expect(
			executeSubprocess({ language: "cobol", code: "DISPLAY 'HI'", timeout: 5000 }),
		).rejects.toThrow("Unsupported language: cobol");
	});
});

describe("compiled languages", () => {
	it.skipIf(!hasGcc)("executes a C program", async () => {
		const result = await executeSubprocess({
			language: "c",
			code: '#include <stdio.h>\nint main() { printf("hello c"); return 0; }',
			timeout: 10000,
		});
		expect(result.stdout.trim()).toBe("hello c");
		expect(result.exitCode).toBe(0);
	});

	it.skipIf(!hasGpp)("executes a C++ program", async () => {
		const result = await executeSubprocess({
			language: "cpp",
			code: '#include <iostream>\nint main() { std::cout << "hello cpp"; return 0; }',
			timeout: 10000,
		});
		expect(result.stdout.trim()).toBe("hello cpp");
		expect(result.exitCode).toBe(0);
	});

	it.skipIf(!hasGcc)("returns compile error for invalid C code", async () => {
		const result = await executeSubprocess({
			language: "c",
			code: "this is not valid C code",
			timeout: 10000,
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toBeTruthy();
	});
});

describe("detectLanguage", () => {
	it("detects from file extension", () => {
		expect(detectLanguage(undefined, "script.py")).toBe("python");
		expect(detectLanguage(undefined, "app.ts")).toBe("typescript");
		expect(detectLanguage(undefined, "run.sh")).toBe("bash");
		expect(detectLanguage(undefined, "main.go")).toBe("go");
	});

	it("detects from shebang", () => {
		expect(detectLanguage(undefined, undefined, "#!/usr/bin/env python3\nprint('hi')")).toBe(
			"python",
		);
		expect(detectLanguage(undefined, undefined, "#!/bin/bash\necho hi")).toBe("bash");
	});

	it("explicit language takes precedence", () => {
		expect(detectLanguage("ruby", "script.py")).toBe("ruby");
	});

	it("throws when nothing detected", () => {
		expect(() => detectLanguage(undefined, undefined, "some code")).toThrow(
			"Cannot detect language",
		);
	});
});
