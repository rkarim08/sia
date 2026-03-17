import { describe, expect, it } from "vitest";
import { extractTrackA } from "@/capture/track-a-ast";

describe("capture/track-a-ast — extractTrackA", () => {
	// ---------------------------------------------------------------
	// Extracts TS function names
	// ---------------------------------------------------------------

	it("extracts TS exported function names", () => {
		const code = [
			'import { foo } from "bar";',
			"export function handleRequest() {",
			"  return 1;",
			"}",
			"export function processData() {",
			"  return 2;",
			"}",
		].join("\n");

		const facts = extractTrackA(code, "src/server.ts");

		const names = facts.map((f) => f.name);
		expect(names).toContain("handleRequest");
		expect(names).toContain("processData");
	});

	// ---------------------------------------------------------------
	// Extracts TS class names
	// ---------------------------------------------------------------

	it("extracts TS exported class names", () => {
		const code = [
			"export class UserService {",
			"  getUser() {}",
			"}",
			"",
			"export class AuthProvider {",
			"  login() {}",
			"}",
		].join("\n");

		const facts = extractTrackA(code, "src/services.ts");

		const names = facts.map((f) => f.name);
		expect(names).toContain("UserService");
		expect(names).toContain("AuthProvider");
	});

	// ---------------------------------------------------------------
	// Extracts TS async function names
	// ---------------------------------------------------------------

	it("extracts TS exported async function names", () => {
		const code = [
			"export async function fetchData() {",
			"  return await fetch('/api');",
			"}",
			"export async function saveRecord() {",
			"  return true;",
			"}",
		].join("\n");

		const facts = extractTrackA(code, "src/api.ts");

		const names = facts.map((f) => f.name);
		expect(names).toContain("fetchData");
		expect(names).toContain("saveRecord");
	});

	// ---------------------------------------------------------------
	// Extracts Python function/class names
	// ---------------------------------------------------------------

	it("extracts Python function and class names", () => {
		const code = [
			"import os",
			"",
			"def parse_config():",
			"    pass",
			"",
			"class ConfigLoader:",
			"    def load(self):",
			"        pass",
			"",
			"def run_server():",
			"    pass",
		].join("\n");

		const facts = extractTrackA(code, "app/config.py");

		const names = facts.map((f) => f.name);
		expect(names).toContain("parse_config");
		expect(names).toContain("ConfigLoader");
		expect(names).toContain("run_server");
	});

	// ---------------------------------------------------------------
	// Returns empty for .txt files
	// ---------------------------------------------------------------

	it("returns empty for .txt files", () => {
		const facts = extractTrackA("some text content", "readme.txt");
		expect(facts).toEqual([]);
	});

	// ---------------------------------------------------------------
	// Returns empty when no filePath
	// ---------------------------------------------------------------

	it("returns empty when no filePath is provided", () => {
		const facts = extractTrackA("export function hello() {}");
		expect(facts).toEqual([]);
	});

	// ---------------------------------------------------------------
	// All results have trust_tier=2 and confidence=0.92
	// ---------------------------------------------------------------

	it("all results have trust_tier=2 and confidence=0.92", () => {
		const code = [
			"export function alpha() {}",
			"export class Beta {}",
			"export const gamma = 1;",
		].join("\n");

		const facts = extractTrackA(code, "src/mixed.ts");
		expect(facts.length).toBeGreaterThan(0);

		for (const fact of facts) {
			expect(fact.trust_tier).toBe(2);
			expect(fact.confidence).toBe(0.92);
		}
	});

	// ---------------------------------------------------------------
	// All results have type='CodeEntity'
	// ---------------------------------------------------------------

	it("all results have type='CodeEntity'", () => {
		const code = [
			"export function one() {}",
			"export async function two() {}",
			"export class Three {}",
			"export const four = true;",
		].join("\n");

		const facts = extractTrackA(code, "src/entities.tsx");
		expect(facts.length).toBeGreaterThan(0);

		for (const fact of facts) {
			expect(fact.type).toBe("CodeEntity");
		}
	});
});
