import { describe, expect, it } from "vitest";
import { edgeInferPrompt } from "@/capture/prompts/edge-infer";

describe("edgeInferPrompt", () => {
	const source = {
		id: "ent-001",
		kind: "Decision",
		name: "Use SQLite",
		content: "We use SQLite for local persistence because it is embedded and fast.",
	};

	const candidates = [
		{
			id: "ent-002",
			kind: "CodeEntity",
			name: "DatabaseAdapter",
			summary: "Adapter class for database operations",
		},
		{
			id: "ent-003",
			kind: "Bug",
			name: "Connection leak",
			summary: "SQLite connections not closed properly",
		},
	];

	it("returns system and user prompt pair", () => {
		const result = edgeInferPrompt(source, candidates);
		expect(result).toHaveProperty("system");
		expect(result).toHaveProperty("user");
		expect(typeof result.system).toBe("string");
		expect(typeof result.user).toBe("string");
	});

	it("system prompt mentions pertains_to edge type", () => {
		const result = edgeInferPrompt(source, candidates);
		expect(result.system).toContain("pertains_to");
	});

	it("system prompt mentions solves edge type", () => {
		const result = edgeInferPrompt(source, candidates);
		expect(result.system).toContain("solves");
	});

	it("system prompt mentions caused_by edge type", () => {
		const result = edgeInferPrompt(source, candidates);
		expect(result.system).toContain("caused_by");
	});

	it("system prompt mentions weight threshold 0.3", () => {
		const result = edgeInferPrompt(source, candidates);
		expect(result.system).toContain("0.3");
	});

	it("system prompt mentions max 5 edges", () => {
		const result = edgeInferPrompt(source, candidates);
		expect(result.system).toContain("5");
	});

	it("user prompt includes source entity data", () => {
		const result = edgeInferPrompt(source, candidates);
		expect(result.user).toContain("ent-001");
		expect(result.user).toContain("Use SQLite");
		expect(result.user).toContain("Decision");
	});

	it("user prompt includes candidate targets", () => {
		const result = edgeInferPrompt(source, candidates);
		expect(result.user).toContain("ent-002");
		expect(result.user).toContain("DatabaseAdapter");
		expect(result.user).toContain("ent-003");
		expect(result.user).toContain("Connection leak");
	});

	it("handles empty candidates array", () => {
		const result = edgeInferPrompt(source, []);
		expect(result.system).toBeTruthy();
		expect(result.user).toContain("ent-001");
		expect(result.user).toContain("[]");
	});
});
