// Module: types — shared types for the capture pipeline

/** The kind of knowledge entity extracted from a conversation. */
export type EntityType =
	| "CodeEntity"
	| "Concept"
	| "Decision"
	| "Bug"
	| "Solution"
	| "Convention"
	| "Dependency";

/** A proposed edge to another entity, resolved by name during consolidation. */
export interface ProposedRelationship {
	target_name: string;
	type: string;
	weight: number;
}

/** A candidate fact produced by extraction tracks before consolidation. */
export interface CandidateFact {
	type: EntityType;
	name: string;
	content: string;
	summary: string;
	tags: string[];
	file_paths: string[];
	trust_tier: 1 | 2 | 3 | 4;
	confidence: number;
	extraction_method?: string;
	proposed_relationships?: ProposedRelationship[];
	t_valid_from?: number;
	/** Monorepo package path, inferred from file_paths. Empty string means root package. */
	package_path?: string | null;
}

/** Payload delivered by Claude-Code hooks into the capture pipeline. */
export interface HookPayload {
	cwd: string;
	type: "PostToolUse" | "Stop";
	sessionId: string;
	content: string;
	toolName?: string;
	filePath?: string;
}

/** Operation the consolidator decides for a candidate. */
export type ConsolidationOp = "ADD" | "UPDATE" | "INVALIDATE" | "NOOP";

/** Aggregate counts returned after a consolidation pass. */
export interface ConsolidationResult {
	added: number;
	updated: number;
	invalidated: number;
	noops: number;
}

/** End-to-end result of a single pipeline invocation. */
export interface PipelineResult {
	candidates: number;
	consolidation: ConsolidationResult;
	edgesCreated: number;
	flagsProcessed: number;
	durationMs: number;
	circuitBreakerActive: boolean;
}
