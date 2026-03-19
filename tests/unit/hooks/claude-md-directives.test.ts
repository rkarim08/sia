import { describe, expect, it } from "vitest";
import { KNOWLEDGE_DIRECTIVES } from "@/hooks/claude-md-directives";

describe("KNOWLEDGE_DIRECTIVES", () => {
	it("is a non-empty string", () => {
		expect(typeof KNOWLEDGE_DIRECTIVES).toBe("string");
		expect(KNOWLEDGE_DIRECTIVES.length).toBeGreaterThan(0);
	});

	it("contains mcp__sia__note references", () => {
		expect(KNOWLEDGE_DIRECTIVES).toContain("mcp__sia__note");
	});

	it("contains mcp__sia__search reference", () => {
		expect(KNOWLEDGE_DIRECTIVES).toContain("mcp__sia__search");
	});

	it("mentions Decision kind", () => {
		expect(KNOWLEDGE_DIRECTIVES).toContain("Decision");
	});

	it("mentions Convention kind", () => {
		expect(KNOWLEDGE_DIRECTIVES).toContain("Convention");
	});

	it("mentions Bug kind", () => {
		expect(KNOWLEDGE_DIRECTIVES).toContain("Bug");
	});

	it("mentions Solution kind", () => {
		expect(KNOWLEDGE_DIRECTIVES).toContain("Solution");
	});

	it("includes guidance about checking prior knowledge", () => {
		// Should mention searching before starting work
		expect(KNOWLEDGE_DIRECTIVES).toMatch(/before|prior|check/i);
	});

	it("includes guidance about decision capture", () => {
		// Should mention architectural alternatives or reasoning
		expect(KNOWLEDGE_DIRECTIVES).toMatch(/decision|architectural|alternative/i);
	});
});
