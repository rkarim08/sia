import { afterEach, describe, expect, it } from "vitest";
import { buildSandboxEnv } from "@/sandbox/credential-pass";

describe("buildSandboxEnv", () => {
	const originalEnv = process.env;

	afterEach(() => {
		process.env = originalEnv;
	});

	it("passes through PATH and HOME", () => {
		process.env = { PATH: "/usr/bin", HOME: "/home/test", SECRET_KEY: "leaked" };
		const env = buildSandboxEnv();
		expect(env.PATH).toBe("/usr/bin");
		expect(env.HOME).toBe("/home/test");
		expect(env.SECRET_KEY).toBeUndefined();
	});

	it("passes through AWS_* glob patterns", () => {
		process.env = { AWS_PROFILE: "dev", AWS_REGION: "us-east-1", RANDOM: "x" };
		const env = buildSandboxEnv();
		expect(env.AWS_PROFILE).toBe("dev");
		expect(env.AWS_REGION).toBe("us-east-1");
		expect(env.RANDOM).toBeUndefined();
	});

	it("passes through GITHUB_* and GH_TOKEN", () => {
		process.env = { GH_TOKEN: "tok", GITHUB_TOKEN: "tok2", GITHUB_ACTIONS: "true" };
		const env = buildSandboxEnv();
		expect(env.GH_TOKEN).toBe("tok");
		expect(env.GITHUB_TOKEN).toBe("tok2");
		expect(env.GITHUB_ACTIONS).toBe("true");
	});

	it("overrides take precedence", () => {
		process.env = { PATH: "/usr/bin" };
		const env = buildSandboxEnv({ PATH: "/custom/bin" });
		expect(env.PATH).toBe("/custom/bin");
	});

	it("never includes non-allowlisted vars", () => {
		process.env = { PATH: "/usr/bin", DB_PASSWORD: "secret", API_KEY: "hidden" };
		const env = buildSandboxEnv();
		expect(Object.keys(env)).not.toContain("DB_PASSWORD");
		expect(Object.keys(env)).not.toContain("API_KEY");
	});

	it("filters overrides through allowlist — rejects LD_PRELOAD", () => {
		process.env = { PATH: "/usr/bin" };
		const env = buildSandboxEnv({
			PATH: "/custom",
			LD_PRELOAD: "/evil.so",
			NODE_OPTIONS: "--inspect",
		});
		expect(env.PATH).toBe("/custom");
		expect(env.LD_PRELOAD).toBeUndefined();
		expect(env.NODE_OPTIONS).toBeUndefined();
	});
});
