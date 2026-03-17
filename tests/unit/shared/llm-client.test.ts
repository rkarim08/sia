import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/shared/config";
import { createFallbackClient, createLlmClient } from "@/shared/llm-client";

describe("LlmClient", () => {
	it("fallback summarize returns truncated content", async () => {
		const client = createFallbackClient();
		const result = await client.summarize("Line one\nLine two\nLine three");
		expect(result).toContain("Line one");
		expect(result).toContain("Line two");
		expect(result).toContain("Line three");
		expect(result.length).toBeLessThanOrEqual(500);
	});

	it("fallback classify returns first option", async () => {
		const client = createFallbackClient();
		const result = await client.classify("test prompt", ["SAME", "DIFFERENT"]);
		expect(result).toBe("SAME");
	});

	it("createLlmClient returns fallback when airGapped", async () => {
		const client = createLlmClient({ ...DEFAULT_CONFIG, airGapped: true });
		expect(client).toBeDefined();
		// Verify it actually works as a fallback by calling summarize
		const result = await client.summarize("Hello world");
		expect(result).toBe("Hello world");
	});

	it("createLlmClient returns fallback when no API key", async () => {
		const origKey = process.env.ANTHROPIC_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		try {
			const client = createLlmClient({ ...DEFAULT_CONFIG, airGapped: false });
			expect(client).toBeDefined();
			// Verify it works as fallback
			const result = await client.summarize("test content");
			expect(result).toBe("test content");
		} finally {
			if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
		}
	});
});
