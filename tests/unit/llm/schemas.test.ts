import { describe, expect, it } from "vitest";
import {
	SiaConsolidationResult,
	SiaExtractionResult,
	SiaSummaryResult,
	SiaValidationResult,
} from "@/llm/schemas";

describe("SiaExtractionResult", () => {
	it("validates correct input", () => {
		const input = {
			entities: [
				{
					kind: "Decision" as const,
					name: "Use SQLite for storage",
					content: "We decided to use SQLite for local graph storage due to simplicity.",
					confidence: 0.95,
					tags: ["database", "storage"],
					relates_to: ["graph-db"],
				},
			],
			_meta: {
				source: "hook" as const,
				input_tokens: 100,
				output_tokens: 50,
			},
		};
		const result = SiaExtractionResult.safeParse(input);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.entities).toHaveLength(1);
			expect(result.data.entities[0].kind).toBe("Decision");
			expect(result.data._meta?.source).toBe("hook");
		}
	});

	it("validates input without _meta", () => {
		const input = {
			entities: [
				{
					kind: "Bug" as const,
					name: "Race condition in pipeline",
					content: "Found a race condition when two hooks fire simultaneously on the same file.",
					confidence: 0.8,
					tags: ["concurrency"],
					relates_to: [],
				},
			],
		};
		const result = SiaExtractionResult.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("rejects missing entities field", () => {
		const input = {
			_meta: { source: "hook" },
		};
		const result = SiaExtractionResult.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("rejects entity with name too short", () => {
		const input = {
			entities: [
				{
					kind: "Decision" as const,
					name: "AB",
					content: "Some valid content that is long enough to pass.",
					confidence: 0.5,
					tags: [],
					relates_to: [],
				},
			],
		};
		const result = SiaExtractionResult.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("rejects entity with content too short", () => {
		const input = {
			entities: [
				{
					kind: "Convention" as const,
					name: "Valid name here",
					content: "Too short",
					confidence: 0.5,
					tags: [],
					relates_to: [],
				},
			],
		};
		const result = SiaExtractionResult.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("rejects invalid kind", () => {
		const input = {
			entities: [
				{
					kind: "InvalidKind",
					name: "Valid entity name",
					content: "Some valid content that is long enough to pass validation.",
					confidence: 0.5,
					tags: [],
					relates_to: [],
				},
			],
		};
		const result = SiaExtractionResult.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("rejects confidence out of range", () => {
		const input = {
			entities: [
				{
					kind: "Concept" as const,
					name: "Valid entity name",
					content: "Some valid content that is long enough to pass validation.",
					confidence: 1.5,
					tags: [],
					relates_to: [],
				},
			],
		};
		const result = SiaExtractionResult.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("rejects too many tags", () => {
		const input = {
			entities: [
				{
					kind: "Solution" as const,
					name: "Valid entity name",
					content: "Some valid content that is long enough to pass validation.",
					confidence: 0.5,
					tags: ["a", "b", "c", "d", "e", "f"],
					relates_to: [],
				},
			],
		};
		const result = SiaExtractionResult.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("accepts all valid entity kinds", () => {
		for (const kind of ["Decision", "Convention", "Bug", "Solution", "Concept"]) {
			const input = {
				entities: [
					{
						kind,
						name: "Valid entity name",
						content: "Some valid content that is long enough to pass validation.",
						confidence: 0.5,
						tags: [],
						relates_to: [],
					},
				],
			};
			const result = SiaExtractionResult.safeParse(input);
			expect(result.success).toBe(true);
		}
	});
});

describe("SiaConsolidationResult", () => {
	it("validates ADD decision", () => {
		const result = SiaConsolidationResult.safeParse({
			decision: "ADD",
			target_id: null,
			reasoning: "New entity not seen before",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.decision).toBe("ADD");
			expect(result.data.target_id).toBeNull();
		}
	});

	it("validates UPDATE decision with target", () => {
		const result = SiaConsolidationResult.safeParse({
			decision: "UPDATE",
			target_id: "entity-123",
			reasoning: "Existing entity needs updating",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.decision).toBe("UPDATE");
			expect(result.data.target_id).toBe("entity-123");
		}
	});

	it("validates INVALIDATE decision", () => {
		const result = SiaConsolidationResult.safeParse({
			decision: "INVALIDATE",
			target_id: "entity-456",
		});
		expect(result.success).toBe(true);
	});

	it("validates NOOP decision", () => {
		const result = SiaConsolidationResult.safeParse({
			decision: "NOOP",
			target_id: null,
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid decision", () => {
		const result = SiaConsolidationResult.safeParse({
			decision: "DELETE",
			target_id: null,
		});
		expect(result.success).toBe(false);
	});
});

describe("SiaSummaryResult", () => {
	it("validates correct summary", () => {
		const result = SiaSummaryResult.safeParse({
			summary: "This community covers database storage patterns using SQLite.",
			key_entities: ["SQLite", "graph-db", "migrations"],
			confidence: 0.9,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.key_entities).toHaveLength(3);
		}
	});

	it("rejects summary too short", () => {
		const result = SiaSummaryResult.safeParse({
			summary: "Too short",
			key_entities: [],
			confidence: 0.5,
		});
		expect(result.success).toBe(false);
	});

	it("rejects too many key_entities", () => {
		const result = SiaSummaryResult.safeParse({
			summary: "A valid summary that is definitely long enough to pass.",
			key_entities: Array.from({ length: 11 }, (_, i) => `entity-${i}`),
			confidence: 0.5,
		});
		expect(result.success).toBe(false);
	});
});

describe("SiaValidationResult", () => {
	it("validates confirm action", () => {
		const result = SiaValidationResult.safeParse({
			is_valid: true,
			confidence: 0.95,
			reasoning: "Fact confirmed by code analysis and recent commits.",
			action: "confirm",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.action).toBe("confirm");
			expect(result.data.is_valid).toBe(true);
		}
	});

	it("validates invalidate action", () => {
		const result = SiaValidationResult.safeParse({
			is_valid: false,
			confidence: 0.8,
			reasoning: "Code has changed significantly since this fact was recorded.",
			action: "invalidate",
		});
		expect(result.success).toBe(true);
	});

	it("validates flag_for_review action", () => {
		const result = SiaValidationResult.safeParse({
			is_valid: true,
			confidence: 0.4,
			reasoning: "Low confidence, needs human review.",
			action: "flag_for_review",
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid action", () => {
		const result = SiaValidationResult.safeParse({
			is_valid: true,
			confidence: 0.5,
			reasoning: "Some reasoning text.",
			action: "delete",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing reasoning", () => {
		const result = SiaValidationResult.safeParse({
			is_valid: true,
			confidence: 0.5,
			action: "confirm",
		});
		expect(result.success).toBe(false);
	});
});
