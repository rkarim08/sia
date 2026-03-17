import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHookPayload, resolveRepoHash } from "@/capture/hook";

describe("capture/hook", () => {
	// ---------------------------------------------------------------
	// parseHookPayload parses valid JSON into HookPayload
	// ---------------------------------------------------------------

	it("parseHookPayload parses valid JSON into HookPayload", () => {
		const input = JSON.stringify({
			cwd: "/project",
			type: "PostToolUse",
			sessionId: "sess-1",
			content: "Created file foo.ts",
			toolName: "write_file",
			filePath: "src/foo.ts",
		});

		const payload = parseHookPayload(input);

		expect(payload.cwd).toBe("/project");
		expect(payload.type).toBe("PostToolUse");
		expect(payload.sessionId).toBe("sess-1");
		expect(payload.content).toBe("Created file foo.ts");
		expect(payload.toolName).toBe("write_file");
		expect(payload.filePath).toBe("src/foo.ts");
	});

	// ---------------------------------------------------------------
	// parseHookPayload throws on invalid JSON
	// ---------------------------------------------------------------

	it("parseHookPayload throws on invalid JSON", () => {
		expect(() => parseHookPayload("not json")).toThrow("Invalid JSON in hook payload");
		expect(() => parseHookPayload("{broken")).toThrow("Invalid JSON in hook payload");
	});

	// ---------------------------------------------------------------
	// parseHookPayload throws on missing required fields
	// ---------------------------------------------------------------

	it("parseHookPayload throws on missing required fields", () => {
		const base = {
			cwd: "/project",
			type: "PostToolUse",
			sessionId: "sess-1",
			content: "hello",
		};

		// missing cwd
		const noCwd = { ...base, cwd: undefined };
		expect(() => parseHookPayload(JSON.stringify(noCwd))).toThrow("cwd");

		// missing type
		const noType = { ...base, type: undefined };
		expect(() => parseHookPayload(JSON.stringify(noType))).toThrow("type");

		// invalid type value
		const badType = { ...base, type: "InvalidType" };
		expect(() => parseHookPayload(JSON.stringify(badType))).toThrow("type");

		// missing sessionId
		const noSession = { ...base, sessionId: undefined };
		expect(() => parseHookPayload(JSON.stringify(noSession))).toThrow("sessionId");

		// missing content
		const noContent = { ...base, content: undefined };
		expect(() => parseHookPayload(JSON.stringify(noContent))).toThrow("content");
	});

	// ---------------------------------------------------------------
	// resolveRepoHash returns SHA-256 hex string
	// ---------------------------------------------------------------

	it("resolveRepoHash returns SHA-256 hex string", () => {
		const hash = resolveRepoHash(".");

		// SHA-256 hex string is 64 characters of [0-9a-f]
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	// ---------------------------------------------------------------
	// resolveRepoHash returns same hash for same path
	// ---------------------------------------------------------------

	it("resolveRepoHash returns same hash for same path", () => {
		const hash1 = resolveRepoHash(".");
		const hash2 = resolveRepoHash(".");

		expect(hash1).toBe(hash2);

		// Verify it matches a manual computation
		const expected = createHash("sha256").update(realpathSync(".")).digest("hex");
		expect(hash1).toBe(expected);
	});
});
