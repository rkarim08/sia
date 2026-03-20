import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const QUERY_DIR = join(__dirname, "../../../../../grammars/queries/typescript");

describe("TypeScript .scm queries", () => {
	it("symbols.scm exists and contains function_declaration capture", () => {
		const source = readFileSync(join(QUERY_DIR, "symbols.scm"), "utf-8");
		expect(source).toContain("function_declaration");
		expect(source).toContain("@name");
	});
	it("imports.scm exists and contains import_statement capture", () => {
		const source = readFileSync(join(QUERY_DIR, "imports.scm"), "utf-8");
		expect(source).toContain("import_statement");
	});
	it("calls.scm exists and contains call_expression capture", () => {
		const source = readFileSync(join(QUERY_DIR, "calls.scm"), "utf-8");
		expect(source).toContain("call_expression");
	});
});
