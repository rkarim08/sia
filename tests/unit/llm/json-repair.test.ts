import { describe, expect, it } from "vitest";
import { parseJsonWithRepair, repairJson } from "@/llm/reliability";

describe("repairJson", () => {
	it("strips markdown code fences", () => {
		const input = '```json\n{"key": "value"}\n```';
		expect(repairJson(input)).toBe('{"key": "value"}');
	});

	it("strips fences without json tag", () => {
		const input = '```\n{"key": "value"}\n```';
		expect(repairJson(input)).toBe('{"key": "value"}');
	});

	it("removes trailing commas in objects", () => {
		const input = '{"a": 1, "b": 2,}';
		expect(repairJson(input)).toBe('{"a": 1, "b": 2}');
	});

	it("removes trailing commas in arrays", () => {
		const input = '["a", "b",]';
		expect(repairJson(input)).toBe('["a", "b"]');
	});

	it("closes unclosed braces", () => {
		const input = '{"a": {"b": 1}';
		const repaired = repairJson(input);
		expect(() => JSON.parse(repaired)).not.toThrow();
	});

	it("closes unclosed brackets", () => {
		const input = '["a", "b"';
		const repaired = repairJson(input);
		expect(() => JSON.parse(repaired)).not.toThrow();
	});

	it("returns valid JSON unchanged", () => {
		const input = '{"key": "value", "num": 42}';
		expect(repairJson(input)).toBe(input);
	});

	it("handles empty string", () => {
		expect(repairJson("")).toBe("");
	});
});

describe("parseJsonWithRepair", () => {
	it("parses valid JSON directly", () => {
		const result = parseJsonWithRepair<{ key: string }>('{"key": "value"}');
		expect(result.key).toBe("value");
	});

	it("repairs and parses markdown-fenced JSON", () => {
		const result = parseJsonWithRepair<{ a: number }>('```json\n{"a": 1}\n```');
		expect(result.a).toBe(1);
	});

	it("repairs trailing commas and parses", () => {
		const result = parseJsonWithRepair<{ a: number; b: number }>('{"a": 1, "b": 2,}');
		expect(result.a).toBe(1);
		expect(result.b).toBe(2);
	});

	it("throws on completely unparseable input", () => {
		expect(() => parseJsonWithRepair("not json at all")).toThrow();
	});
});
