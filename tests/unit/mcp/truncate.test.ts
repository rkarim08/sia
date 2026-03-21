import { describe, expect, it } from "vitest";
import { truncateResponse } from "@/mcp/truncate";

describe("truncateResponse", () => {
	it("should pass through small responses unchanged", () => {
		const input = { entities: [{ id: "1", name: "test" }], total: 1 };
		const result = truncateResponse(input, 8000);
		expect(result).toEqual(input);
	});

	it("should pass through null and undefined unchanged", () => {
		expect(truncateResponse(null, 4000)).toBeNull();
		expect(truncateResponse(undefined, 4000)).toBeUndefined();
	});

	it("should pass through when maxChars is below minimum", () => {
		const input = { entities: [{ id: "1" }] };
		expect(truncateResponse(input, 50)).toEqual(input);
	});

	it("should pass through exactly-at-limit responses unchanged", () => {
		const input = { ok: true };
		const serialized = JSON.stringify(input);
		const result = truncateResponse(input, serialized.length);
		expect(result).toEqual(input);
	});

	// --- Array truncation (dynamic key detection) ---

	it("should truncate 'entities' array (not just 'results')", () => {
		const largeEntities = Array.from({ length: 500 }, (_, i) => ({
			id: `entity-${i}`,
			name: `Entity number ${i}`,
			content: "A".repeat(100),
		}));
		const input = { entities: largeEntities, total: 500 };
		const result = truncateResponse(input, 4000) as Record<string, unknown>;
		const serialized = JSON.stringify(result);
		expect(serialized.length).toBeLessThanOrEqual(4000);
		expect(result._truncated).toBe(true);
		expect(result._original_count).toBe(500);
		expect((result.entities as unknown[]).length).toBeLessThan(500);
	});

	it("should truncate 'results' array via dynamic detection", () => {
		const largeResults = Array.from({ length: 200 }, (_, i) => ({
			id: `r-${i}`,
			name: `Result ${i}`,
			content: "B".repeat(200),
		}));
		const input = { results: largeResults, total: 200 };
		const result = truncateResponse(input, 4000) as Record<string, unknown>;
		expect(result._truncated).toBe(true);
		expect(result._original_count).toBe(200);
		expect((result.results as unknown[]).length).toBeLessThan(200);
	});

	it("should truncate 'communities' array", () => {
		const largeCommunities = Array.from({ length: 100 }, (_, i) => ({
			id: `c-${i}`,
			summary: "C".repeat(200),
		}));
		const input = { communities: largeCommunities };
		const result = truncateResponse(input, 4000) as Record<string, unknown>;
		expect(result._truncated).toBe(true);
		expect((result.communities as unknown[]).length).toBeLessThan(100);
	});

	it("should add truncation metadata when truncated", () => {
		const largeEntities = Array.from({ length: 200 }, (_, i) => ({
			id: `entity-${i}`,
			name: `Entity ${i}`,
			content: "B".repeat(200),
		}));
		const input = { entities: largeEntities, total: 200 };
		const result = truncateResponse(input, 4000) as Record<string, unknown>;
		expect(result._truncated).toBe(true);
		expect(result._original_count).toBe(200);
		expect(typeof result._showing).toBe("number");
		expect(result._showing).toBeGreaterThan(0);
		expect(result._showing).toBeLessThan(200);
		// _showing must match actual truncated array length
		expect(result._showing).toBe((result.entities as unknown[]).length);
	});

	it("should truncate bare arrays (e.g. sia_search returns T[])", () => {
		const input = Array.from({ length: 200 }, (_, i) => ({
			id: `r-${i}`,
			name: `Result ${i}`,
			content: "X".repeat(200),
		}));
		const result = truncateResponse(input, 4000) as Record<string, unknown>;
		expect(result._truncated).toBe(true);
		expect(result._original_count).toBe(200);
		expect(Array.isArray(result.items)).toBe(true);
		expect((result.items as unknown[]).length).toBeLessThan(200);
		expect(result._showing).toBe((result.items as unknown[]).length);
		expect(JSON.stringify(result).length).toBeLessThanOrEqual(4000);
	});

	it("should truncate nested Record<string, T[]> grouped collections (backlinks-style)", () => {
		const backlinks: Record<string, unknown[]> = {};
		for (let i = 0; i < 10; i++) {
			backlinks[`edge_type_${i}`] = Array.from({ length: 20 }, (_, j) => ({
				id: `e-${i}-${j}`,
				name: `Entity ${i}-${j}`,
				summary: "S".repeat(100),
			}));
		}
		const input = { target_id: "node-1", backlinks, total_count: 200 };
		const result = truncateResponse(input, 4000) as Record<string, unknown>;
		expect(result._truncated).toBe(true);
		expect(result._flattened).toBe(true);
		expect(result._original_count).toBe(200);
		expect(result._message).toBeUndefined();
		expect(Array.isArray(result.backlinks)).toBe(true);
		const groups = result._original_groups as Record<string, number>;
		expect(groups).toBeDefined();
		expect(Object.keys(groups)).toHaveLength(10);
		expect(groups.edge_type_0).toBe(20);
	});

	it("should pick the largest array for truncation on multi-array objects", () => {
		const small = Array.from({ length: 5 }, (_, i) => ({ id: `s-${i}` }));
		const large = Array.from({ length: 200 }, (_, i) => ({
			id: `l-${i}`,
			data: "X".repeat(100),
		}));
		const input = { small_list: small, large_list: large };
		const result = truncateResponse(input, 4000) as Record<string, unknown>;
		expect(result._truncated).toBe(true);
		expect((result.large_list as unknown[]).length).toBeLessThan(200);
		expect((result.small_list as unknown[]).length).toBe(5);
	});

	// --- Edge cases ---

	it("should return overflow envelope when single item exceeds budget", () => {
		const hugeItem = [{ id: "1", content: "X".repeat(10000) }];
		const input = { entities: hugeItem, total: 1 };
		const result = truncateResponse(input, 500) as Record<string, unknown>;
		expect(result._truncated).toBe(true);
		expect(result._message).toContain("too large");
		expect(result._original_count).toBe(1);
		expect(result.entities).toBeUndefined();
	});

	it("should return overflow envelope for bare array when single item exceeds budget", () => {
		const input = [{ id: "1", content: "X".repeat(10000) }];
		const result = truncateResponse(input, 500) as Record<string, unknown>;
		expect(result._truncated).toBe(true);
		expect(result._message).toContain("too large");
		expect(result._original_count).toBe(1);
		expect(result.items).toBeUndefined();
	});

	it("should return serialization error envelope for circular references", () => {
		const obj: Record<string, unknown> = { id: "1" };
		obj.self = obj;
		const result = truncateResponse(obj, 4000) as Record<string, unknown>;
		expect(result._truncated).toBe(true);
		expect(result._serialization_error).toBe(true);
		expect(typeof result._message).toBe("string");
		expect(result._message).toContain("could not be serialized");
	});

	it("should skip empty arrays and return overflow envelope", () => {
		const input = { metadata: "M".repeat(10000), items: [] as unknown[] };
		const result = truncateResponse(input, 500) as Record<string, unknown>;
		expect(result._truncated).toBe(true);
		expect(result._message).toContain("exceeded size limit");
	});

	// --- Non-array object fallback ---

	it("should return overflow envelope for object with no array property", () => {
		const input = { status: "ok", data: "A".repeat(10000) };
		const result = truncateResponse(input, 4000) as Record<string, unknown>;
		expect(result._truncated).toBe(true);
		expect(result._message).toContain("exceeded size limit");
		expect(result._original_size).toBeGreaterThan(4000);
		const serialized = JSON.stringify(result);
		expect(serialized.length).toBeLessThan(4000);
	});

	// --- String responses ---

	it("should return truncation envelope for string responses", () => {
		const input = "A".repeat(10000);
		const result = truncateResponse(input, 4000) as Record<string, unknown>;
		expect(typeof result).toBe("object");
		expect(result._truncated).toBe(true);
		expect(result._original_size).toBe(10000);
		expect(typeof result.text).toBe("string");
		expect((result.text as string).length).toBeLessThan(4000);
	});

	// --- Default maxChars ---

	it("should use default maxChars (8000) when not specified", () => {
		const input = { ok: true, data: "X".repeat(100) };
		expect(truncateResponse(input)).toEqual(input);
	});

	// --- JSON.stringify safety ---

	it("should always return valid JSON when wrapped in JSON.stringify", () => {
		const cases = [
			{ entities: Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, data: "X".repeat(200) })) },
			{ status: "ok", data: "A".repeat(10000) },
			"B".repeat(10000),
		];
		for (const input of cases) {
			const result = truncateResponse(input, 2000);
			const json = JSON.stringify(result);
			expect(() => JSON.parse(json)).not.toThrow();
		}
	});
});
