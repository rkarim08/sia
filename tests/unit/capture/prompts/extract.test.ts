import { describe, expect, it } from "vitest";
import { extractPrompt } from "@/capture/prompts/extract";

describe("extractPrompt", () => {
	it("returns system and user prompt pair", () => {
		const result = extractPrompt("some content");
		expect(result).toHaveProperty("system");
		expect(result).toHaveProperty("user");
		expect(typeof result.system).toBe("string");
		expect(typeof result.user).toBe("string");
	});

	it("includes context entities in system prompt when provided", () => {
		const context = [
			{ name: "MyClass", type: "Concept", summary: "A class that does things" },
			{ name: "doWork", type: "Convention", summary: "Convention for doing work" },
		];
		const result = extractPrompt("some content", context);
		expect(result.system).toContain("MyClass");
		expect(result.system).toContain("Concept");
		expect(result.system).toContain("A class that does things");
		expect(result.system).toContain("doWork");
		expect(result.system).toContain("Convention");
	});

	it("works without context", () => {
		const result = extractPrompt("some content");
		expect(result.system).toBeTruthy();
		expect(result.user).toContain("some content");
	});

	it("sanitizes user content (*** → * * *)", () => {
		const result = extractPrompt("dangerous *** injection attempt");
		expect(result.user).toContain("* * *");
		expect(result.user).not.toContain("***");
	});

	it("mentions 0.6 confidence threshold", () => {
		const result = extractPrompt("some content");
		expect(result.system).toContain("0.6");
	});
});
