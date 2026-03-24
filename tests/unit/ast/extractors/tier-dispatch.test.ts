import { describe, expect, it } from "vitest";
import { dispatchExtraction, dispatchExtractionAsync } from "@/ast/extractors/tier-dispatch";

describe("dispatchExtractionAsync import relationships", () => {
	it("should populate proposed_relationships for TypeScript imports", async () => {
		const content = `import { useState } from "react";\nimport { join } from "node:path";\n`;
		const facts = await dispatchExtractionAsync(content, "test.ts", "A", "typescript");

		// Find facts tagged as imports
		const importFacts = facts.filter((f) => f.tags?.includes("import"));

		// At least some import facts should have proposed_relationships
		const withRels = importFacts.filter(
			(f) => f.proposed_relationships && f.proposed_relationships.length > 0,
		);
		expect(withRels.length).toBeGreaterThan(0);

		// Check the relationship shape
		const rel = withRels[0].proposed_relationships?.[0];
		if (!rel) throw new Error("unreachable: expected relationship");
		expect(rel.type).toBe("imports");
		expect(rel.target_name).toBeTruthy();
		expect(rel.weight).toBeGreaterThan(0);
	});

	it("should populate proposed_relationships for regex-fallback imports", async () => {
		const content = `import { foo } from "bar";\nimport baz from "qux";\n`;
		// Use dispatchExtraction directly (regex path)
		const facts = dispatchExtraction(content, "test.ts", "A");

		const importFacts = facts.filter((f) => f.tags?.includes("import"));
		expect(importFacts.length).toBeGreaterThan(0);

		// Regex path should also populate proposed_relationships where possible
		const withRels = importFacts.filter(
			(f) => f.proposed_relationships && f.proposed_relationships.length > 0,
		);
		expect(withRels.length).toBeGreaterThan(0);
	});
});
