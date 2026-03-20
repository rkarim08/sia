import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSandboxEnv } from "../../../src/sandbox/credential-pass";

describe("buildSandboxEnv", () => {
	// Save and restore process.env around each test
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		// Restore process.env
		for (const key of Object.keys(process.env)) {
			if (!(key in originalEnv)) {
				delete process.env[key];
			}
		}
		for (const [key, value] of Object.entries(originalEnv)) {
			process.env[key] = value;
		}
	});

	it("PATH is inherited", () => {
		process.env.PATH = "/usr/bin:/usr/local/bin";
		const env = buildSandboxEnv();
		expect(env.PATH).toBe("/usr/bin:/usr/local/bin");
	});

	it("HOME is inherited", () => {
		process.env.HOME = "/home/testuser";
		const env = buildSandboxEnv();
		expect(env.HOME).toBe("/home/testuser");
	});

	it("AWS_PROFILE is included", () => {
		process.env.AWS_PROFILE = "test";
		const env = buildSandboxEnv();
		expect(env.AWS_PROFILE).toBe("test");
	});

	it("AWS_* vars are inherited", () => {
		process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
		process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
		const env = buildSandboxEnv();
		expect(env.AWS_ACCESS_KEY_ID).toBe("AKIAIOSFODNN7EXAMPLE");
		expect(env.AWS_SECRET_ACCESS_KEY).toBe("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
	});

	it("GOOGLE_* vars are inherited", () => {
		process.env.GOOGLE_APPLICATION_CREDENTIALS = "/path/to/creds.json";
		const env = buildSandboxEnv();
		expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe("/path/to/creds.json");
	});

	it("GCLOUD_* vars are inherited", () => {
		process.env.GCLOUD_PROJECT = "my-project";
		const env = buildSandboxEnv();
		expect(env.GCLOUD_PROJECT).toBe("my-project");
	});

	it("DOCKER_* vars are inherited", () => {
		process.env.DOCKER_HOST = "tcp://localhost:2376";
		const env = buildSandboxEnv();
		expect(env.DOCKER_HOST).toBe("tcp://localhost:2376");
	});

	it("KUBECONFIG is inherited", () => {
		process.env.KUBECONFIG = "/home/user/.kube/config";
		const env = buildSandboxEnv();
		expect(env.KUBECONFIG).toBe("/home/user/.kube/config");
	});

	it("GH_TOKEN is inherited", () => {
		process.env.GH_TOKEN = "ghp_xxxx";
		const env = buildSandboxEnv();
		expect(env.GH_TOKEN).toBe("ghp_xxxx");
	});

	it("GITHUB_TOKEN is inherited", () => {
		process.env.GITHUB_TOKEN = "ghp_yyyy";
		const env = buildSandboxEnv();
		expect(env.GITHUB_TOKEN).toBe("ghp_yyyy");
	});

	it("NPM_TOKEN is inherited", () => {
		process.env.NPM_TOKEN = "npm_xxxx";
		const env = buildSandboxEnv();
		expect(env.NPM_TOKEN).toBe("npm_xxxx");
	});

	it("NODE_AUTH_TOKEN is inherited", () => {
		process.env.NODE_AUTH_TOKEN = "auth_xxxx";
		const env = buildSandboxEnv();
		expect(env.NODE_AUTH_TOKEN).toBe("auth_xxxx");
	});

	it("SIA_HOOK_PORT is NOT in result", () => {
		process.env.SIA_HOOK_PORT = "4521";
		const env = buildSandboxEnv();
		expect(env.SIA_HOOK_PORT).toBeUndefined();
	});

	it("SIA_* vars are excluded", () => {
		process.env.SIA_HOOK_PORT = "4521";
		process.env.SIA_DB_PATH = "/some/path";
		process.env.SIA_SECRET = "topsecret";
		const env = buildSandboxEnv();
		const siaKeys = Object.keys(env).filter((k) => k.startsWith("SIA_"));
		expect(siaKeys).toHaveLength(0);
	});

	it("result contains only string values", () => {
		const env = buildSandboxEnv();
		for (const value of Object.values(env)) {
			expect(typeof value).toBe("string");
		}
	});
});
