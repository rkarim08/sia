import { describe, expect, it } from "vitest";
import { batchExtractionPrompt } from "@/llm/prompts/extraction";

describe("batchExtractionPrompt", () => {
	it("contains XML delimiters in system prompt", () => {
		const { system } = batchExtractionPrompt("some transcript content");
		expect(system).toContain("<instructions>");
		expect(system).toContain("</instructions>");
	});

	it("includes transcript content in user prompt", () => {
		const transcript = "User asked about TypeScript strict mode. Agent enabled it.";
		const { user } = batchExtractionPrompt(transcript);
		expect(user).toContain(transcript);
		expect(user).toContain("<transcript>");
		expect(user).toContain("</transcript>");
	});

	it("includes context entities when provided", () => {
		const context = [
			{ name: "TypeScript", type: "Technology" },
			{ name: "SiaDb", type: "Interface" },
		];
		const { user } = batchExtractionPrompt("some transcript", context);
		expect(user).toContain("TypeScript");
		expect(user).toContain("SiaDb");
		expect(user).toContain("<context>");
		expect(user).toContain("</context>");
	});

	it("works without context (omits context block or leaves it empty)", () => {
		const { user } = batchExtractionPrompt("some transcript");
		expect(user).toContain("<transcript>");
		// Should not throw or include undefined
		expect(user).not.toContain("undefined");
	});

	it("returns both system and user strings", () => {
		const result = batchExtractionPrompt("test transcript");
		expect(typeof result.system).toBe("string");
		expect(typeof result.user).toBe("string");
		expect(result.system.length).toBeGreaterThan(0);
		expect(result.user.length).toBeGreaterThan(0);
	});

	it("system prompt instructs extraction of structured knowledge", () => {
		const { system } = batchExtractionPrompt("test");
		expect(system.toLowerCase()).toContain("extract");
	});

	it("is compatible with multiple providers (uses XML not markdown-only)", () => {
		const { system, user } = batchExtractionPrompt("test transcript");
		// XML delimiters work across Claude, GPT, Gemini, Ollama
		expect(system).toMatch(/<[a-z]+>/);
		expect(user).toMatch(/<[a-z]+>/);
	});
});
