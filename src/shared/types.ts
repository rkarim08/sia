// src/shared/types.ts — Cross-module type aliases
// No runtime code. No imports from other Sia modules (prevents circular deps).

// ── Semantic aliases ──────────────────────────────────────────
export type UnixMs = number;
export type RepoHash = string;
export type PackagePath = string | null;
export type NodeId = string;
export type EdgeId = string;
export type SessionId = string;

// ── Trust ─────────────────────────────────────────────────────
export type TrustTier = 1 | 2 | 3 | 4;

// ── Operations ────────────────────────────────────────────────
// Re-exported from capture/types.ts to provide a single shared import path.
export type { ConsolidationOp } from "@/capture/types";
export type ValidationStatus = "pending" | "passed" | "rejected" | "quarantined";
export type ProcessingStatus = "complete" | "partial" | "failed";
export type Visibility = "private" | "team" | "project";

// ── Current entity types ──────────────────────────────────────
// Re-exported from capture/types.ts to avoid duplication.
export type { EntityType } from "@/capture/types";

// ── Forward-looking node kinds (Phase 14+ unified graph_nodes schema) ──
// Current code should use EntityType above. These are for future phases.
export type StructuralKind = "CodeSymbol" | "FileNode" | "PackageNode";
export type SemanticKind =
	| "Concept"
	| "Decision"
	| "Bug"
	| "Solution"
	| "Convention"
	| "Community"
	| "ContentChunk";
export type EventKind =
	| "SessionNode"
	| "EditEvent"
	| "ExecutionEvent"
	| "SearchEvent"
	| "GitEvent"
	| "ErrorEvent"
	| "UserDecision"
	| "UserPrompt"
	| "TaskNode";
export type NodeKind = StructuralKind | SemanticKind | EventKind | "ExternalRef";

// ── Edge types (current schema) ───────────────────────────────
export type StructuralEdgeType =
	| "defines"
	| "imports"
	| "calls"
	| "inherits_from"
	| "contains"
	| "depends_on";
export type SemanticEdgeType =
	| "pertains_to"
	| "solves"
	| "caused_by"
	| "supersedes"
	| "elaborates"
	| "contradicts"
	| "relates_to"
	| "references";
export type CommunityEdgeType = "member_of" | "summarized_by";
export type EdgeType = StructuralEdgeType | SemanticEdgeType | CommunityEdgeType;

// ── Forward-looking edge types (Phase 14+) ────────────────────
export type EventEdgeType =
	| "modifies"
	| "triggered_by"
	| "produced_by"
	| "resolves"
	| "during_task"
	| "precedes";
export type SessionEdgeType = "part_of" | "continued_from";
export type DocEdgeType = "child_of";
export type AllEdgeType = EdgeType | EventEdgeType | SessionEdgeType | DocEdgeType;
