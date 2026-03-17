import { describe, expect, it } from "vitest";
import type {
	CandidateFact,
	ConsolidationOp,
	ConsolidationResult,
	EntityType,
	HookPayload,
	PipelineResult,
	ProposedRelationship,
} from "@/capture/types";

describe("capture/types", () => {
	// ---------------------------------------------------------------
	// EntityType accepts all valid string literals
	// ---------------------------------------------------------------

	it("EntityType accepts all valid literals", () => {
		const types: EntityType[] = [
			"CodeEntity",
			"Concept",
			"Decision",
			"Bug",
			"Solution",
			"Convention",
		];
		expect(types).toHaveLength(6);
	});

	// ---------------------------------------------------------------
	// ProposedRelationship is constructible
	// ---------------------------------------------------------------

	it("ProposedRelationship is constructible", () => {
		const rel: ProposedRelationship = {
			target_name: "handleAuth",
			type: "CALLS",
			weight: 0.9,
		};
		expect(rel.target_name).toBe("handleAuth");
		expect(rel.type).toBe("CALLS");
		expect(rel.weight).toBe(0.9);
	});

	// ---------------------------------------------------------------
	// CandidateFact is constructible with required fields
	// ---------------------------------------------------------------

	it("CandidateFact is constructible with required fields", () => {
		const fact: CandidateFact = {
			type: "CodeEntity",
			name: "parseConfig",
			content: "function parseConfig() { ... }",
			summary: "Parses configuration from env",
			tags: ["config", "parser"],
			file_paths: ["src/config.ts"],
			trust_tier: 2,
			confidence: 0.85,
		};
		expect(fact.type).toBe("CodeEntity");
		expect(fact.name).toBe("parseConfig");
		expect(fact.trust_tier).toBe(2);
		expect(fact.confidence).toBe(0.85);
	});

	// ---------------------------------------------------------------
	// CandidateFact accepts optional fields
	// ---------------------------------------------------------------

	it("CandidateFact accepts optional fields", () => {
		const fact: CandidateFact = {
			type: "Decision",
			name: "use-sqlite",
			content: "We chose SQLite for local storage",
			summary: "SQLite chosen for persistence",
			tags: ["architecture"],
			file_paths: [],
			trust_tier: 1,
			confidence: 0.95,
			extraction_method: "llm",
			proposed_relationships: [{ target_name: "StorageLayer", type: "RELATES_TO", weight: 0.8 }],
			t_valid_from: Date.now(),
		};
		expect(fact.extraction_method).toBe("llm");
		expect(fact.proposed_relationships).toHaveLength(1);
		expect(fact.t_valid_from).toBeGreaterThan(0);
	});

	// ---------------------------------------------------------------
	// HookPayload is constructible with required fields
	// ---------------------------------------------------------------

	it("HookPayload is constructible with required fields", () => {
		const payload: HookPayload = {
			cwd: "/project",
			type: "PostToolUse",
			sessionId: "abc-123",
			content: "Created file foo.ts",
		};
		expect(payload.type).toBe("PostToolUse");
		expect(payload.cwd).toBe("/project");
	});

	// ---------------------------------------------------------------
	// HookPayload accepts optional fields
	// ---------------------------------------------------------------

	it("HookPayload accepts optional fields", () => {
		const payload: HookPayload = {
			cwd: "/project",
			type: "Stop",
			sessionId: "abc-123",
			content: "Session ended",
			toolName: "write_file",
			filePath: "src/index.ts",
		};
		expect(payload.toolName).toBe("write_file");
		expect(payload.filePath).toBe("src/index.ts");
	});

	// ---------------------------------------------------------------
	// ConsolidationOp accepts all valid literals
	// ---------------------------------------------------------------

	it("ConsolidationOp accepts all valid literals", () => {
		const ops: ConsolidationOp[] = ["ADD", "UPDATE", "INVALIDATE", "NOOP"];
		expect(ops).toHaveLength(4);
	});

	// ---------------------------------------------------------------
	// ConsolidationResult is constructible
	// ---------------------------------------------------------------

	it("ConsolidationResult is constructible", () => {
		const result: ConsolidationResult = {
			added: 3,
			updated: 1,
			invalidated: 0,
			noops: 2,
		};
		expect(result.added).toBe(3);
		expect(result.updated).toBe(1);
		expect(result.invalidated).toBe(0);
		expect(result.noops).toBe(2);
	});

	// ---------------------------------------------------------------
	// PipelineResult is constructible
	// ---------------------------------------------------------------

	it("PipelineResult is constructible", () => {
		const result: PipelineResult = {
			candidates: 5,
			consolidation: { added: 3, updated: 1, invalidated: 0, noops: 1 },
			edgesCreated: 4,
			flagsProcessed: 2,
			durationMs: 120,
			circuitBreakerActive: false,
		};
		expect(result.candidates).toBe(5);
		expect(result.consolidation.added).toBe(3);
		expect(result.edgesCreated).toBe(4);
		expect(result.durationMs).toBe(120);
		expect(result.circuitBreakerActive).toBe(false);
	});
});
