import { describe, expect, it } from "vitest";
import { executeSubprocess } from "../../../src/sandbox/executor";

describe("executeSubprocess", () => {
	it("executes bash echo and captures stdout", async () => {
		const result = await executeSubprocess({
			language: "bash",
			code: "echo hello",
			timeoutMs: 5000,
		});
		expect(result.stdout).toBe("hello\n");
		expect(result.exitCode).toBe(0);
		expect(result.timedOut).toBe(false);
	});

	it("returns timedOut true when process exceeds timeout", async () => {
		const result = await executeSubprocess({
			language: "bash",
			code: "sleep 10",
			timeoutMs: 500,
		});
		expect(result.timedOut).toBe(true);
	}, 10000);

	it("captures non-zero exit code", async () => {
		const result = await executeSubprocess({
			language: "bash",
			code: "exit 42",
			timeoutMs: 5000,
		});
		expect(result.exitCode).toBe(42);
		expect(result.timedOut).toBe(false);
	});
});
