import { describe, expect, it } from "vitest";
import { consolidatePrompt } from "@/capture/prompts/consolidate";

describe("consolidatePrompt", () => {
	const candidate = {
		kind: "Decision",
		name: "Use SQLite",
		content: "We use SQLite for local persistence because it is embedded and fast.",
		summary: "SQLite chosen for local persistence",
	};

	const existingEntities = [
		{
			id: "ent-001",
			name: "Database Choice",
			content: "The project uses PostgreSQL for production.",
			summary: "PostgreSQL for production",
			type: "Decision",
		},
		{
			id: "ent-002",
			name: "Storage Strategy",
			content: "All data stored in flat files for simplicity.",
			summary: "Flat file storage",
			type: "Convention",
		},
	];

	it("system prompt contains all 4 operations (NOOP, UPDATE, INVALIDATE, ADD)", () => {
		const result = consolidatePrompt(candidate, existingEntities);
		expect(result.system).toContain("NOOP");
		expect(result.system).toContain("UPDATE");
		expect(result.system).toContain("INVALIDATE");
		expect(result.system).toContain("ADD");
	});

	it("user prompt includes candidate data", () => {
		const result = consolidatePrompt(candidate, existingEntities);
		expect(result.user).toContain("Use SQLite");
		expect(result.user).toContain("SQLite chosen for local persistence");
	});

	it("user prompt includes existing entities with IDs", () => {
		const result = consolidatePrompt(candidate, existingEntities);
		expect(result.user).toContain("ent-001");
		expect(result.user).toContain("ent-002");
		expect(result.user).toContain("Database Choice");
		expect(result.user).toContain("Storage Strategy");
	});

	it("handles empty existing entities array", () => {
		const result = consolidatePrompt(candidate, []);
		expect(result.system).toBeTruthy();
		expect(result.user).toBeTruthy();
		expect(result.user).toContain("Use SQLite");
		// Should not throw and should still contain candidate
		expect(result.user).toContain("[]");
	});
});
