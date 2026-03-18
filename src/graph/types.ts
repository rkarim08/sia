// src/graph/types.ts — Graph domain interfaces for communities, episodes, and MCP results

import type { PackagePath, TrustTier, UnixMs } from "@/shared/types";

// ── Community types ───────────────────────────────────────────

export interface Community {
	id: string;
	level: 0 | 1 | 2;
	parent_id: string | null;
	summary: string | null;
	summary_hash: string | null;
	member_count: number;
	last_summary_member_count: number;
	package_path: PackagePath;
	created_at: UnixMs;
	updated_at: UnixMs;
}

export interface CommunityMember {
	community_id: string;
	entity_id: string;
	level: 0 | 1 | 2;
}

export interface InsertCommunityInput {
	level: 0 | 1 | 2;
	parent_id?: string | null;
	package_path?: PackagePath;
}

export interface UpdateCommunityInput {
	summary?: string | null;
	summary_hash?: string | null;
	member_count?: number;
	last_summary_member_count?: number;
}

export interface CommunitySummary {
	id: string;
	level: 0 | 1 | 2;
	summary: string;
	member_count: number;
	top_entities: Array<{ name: string; type: string }>;
}

// ── Episode types ─────────────────────────────────────────────

export interface Episode {
	id: string;
	session_id: string;
	ts: UnixMs;
	type: "conversation" | "tool_use" | "file_read" | "command";
	role: "user" | "assistant" | "tool" | null;
	content: string;
	tool_name: string | null;
	file_path: string | null;
	trust_tier: TrustTier;
}

export interface InsertEpisodeInput {
	session_id: string;
	type: Episode["type"];
	role?: Episode["role"];
	content: string;
	tool_name?: string | null;
	file_path?: string | null;
	trust_tier?: TrustTier;
}

// ── MCP result types ──────────────────────────────────────────

export interface SiaSearchResult {
	entity_id: string;
	type: string;
	name: string;
	summary: string;
	content: string;
	tags: string[];
	file_paths: string[];
	trust_tier: TrustTier;
	confidence: number;
	importance: number;
	extraction_method?: string;
	conflict_group_id?: string | null;
	t_valid_from?: UnixMs | null;
	t_valid_until?: UnixMs | null;
	source_repo_id?: string;
	source_repo_name?: string;
	freshness?: "fresh" | "stale" | "rotten";
	freshness_detail?: {
		source_path: string;
		source_mtime: number;
		extraction_time: number;
		divergence_seconds: number;
		confidence: number;
		alpha?: number;
		beta?: number;
	};
}

export interface SiaEdge {
	id: string;
	from_id: string;
	to_id: string;
	type: string;
	weight: number;
	confidence: number;
}

export interface SiaExpandResult {
	center: SiaSearchResult;
	neighbors: SiaSearchResult[];
	edges: SiaEdge[];
	edge_count: number;
}

export interface SiaTemporalResult {
	entities: SiaSearchResult[];
	invalidated_entities: SiaSearchResult[];
	edges: SiaEdge[];
	invalidated_count: number;
}

export interface SiaCommunityResult {
	communities: CommunitySummary[];
	global_unavailable: boolean;
}
