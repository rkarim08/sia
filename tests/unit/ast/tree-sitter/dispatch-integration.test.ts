import { describe, expect, it } from "vitest";
import { dispatchExtraction, dispatchExtractionAsync } from "@/ast/extractors/tier-dispatch";

describe("dispatchExtraction (sync, unchanged)", () => {
	it("still returns CandidateFact[] for TypeScript file via regex", () => {
		const content =
			'export function greet(name: string): string {\n  return "Hello " + name;\n}\n\nexport class Greeter {\n  greet(name: string) {\n    return "Hello " + name;\n  }\n}\n';
		const facts = dispatchExtraction(content, "src/greeter.ts", "A");
		expect(facts.length).toBeGreaterThan(0);
		const names = facts.map((f) => f.name);
		expect(names).toContain("greet");
		expect(names).toContain("Greeter");
	});

	it("Tier C/D still use special handlers unchanged", () => {
		const sqlContent = "CREATE TABLE users (id INT PRIMARY KEY, name TEXT);";
		const facts = dispatchExtraction(sqlContent, "schema.sql", "C", "sql-schema");
		expect(facts.length).toBeGreaterThan(0);
		expect(facts[0].extraction_method).toBe("sql-schema");
	});
});

describe("dispatchExtractionAsync (tree-sitter path)", () => {
	it("returns facts with tree-sitter or regex-fallback method", async () => {
		const content = "export function hello() { return 1; }";
		const facts = await dispatchExtractionAsync(content, "src/hello.ts", "A", "typescript");
		expect(facts.length).toBeGreaterThan(0);
		for (const fact of facts) {
			expect(["tree-sitter", "regex-fallback"]).toContain(fact.extraction_method);
		}
	});

	it("special handlers pass through to sync dispatch", async () => {
		const sqlContent = "CREATE TABLE users (id INT PRIMARY KEY, name TEXT);";
		const facts = await dispatchExtractionAsync(sqlContent, "schema.sql", "C", "sql", "sql-schema");
		expect(facts.length).toBeGreaterThan(0);
		expect(facts[0].extraction_method).toBe("sql-schema");
	});
});
