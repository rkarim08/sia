// Module: import — load graph from exported JSON (merge or replace mode)

import { readFileSync } from "node:fs";
import { consolidate } from "@/capture/consolidate";
import type { CandidateFact } from "@/capture/types";
import type { ExportData } from "@/cli/commands/export";
import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";

/** Aggregate counts returned after an import operation. */
export interface ImportResult {
	entitiesImported: number;
	edgesImported: number;
	communitiesImported: number;
	mode: "merge" | "replace";
}

/**
 * Import graph data from an ExportData payload.
 *
 * Two modes:
 * - **merge**: converts entities to CandidateFact[] and runs through the
 *   consolidation pipeline; edges are inserted only when both endpoints exist;
 *   communities use INSERT OR IGNORE.
 * - **replace**: archives all active entities, then bulk-inserts everything
 *   from the export data directly.
 */
export async function importGraph(
	db: SiaDb,
	data: ExportData,
	mode: "merge" | "replace",
): Promise<ImportResult> {
	if (data.version !== 1) {
		throw new Error(`Unsupported export version: ${data.version}. Expected version 1.`);
	}

	if (mode === "merge") {
		return mergeImport(db, data);
	}
	return replaceImport(db, data);
}

// ---------------------------------------------------------------------------
// Merge mode
// ---------------------------------------------------------------------------

async function mergeImport(db: SiaDb, data: ExportData): Promise<ImportResult> {
	const result: ImportResult = {
		entitiesImported: 0,
		edgesImported: 0,
		communitiesImported: 0,
		mode: "merge",
	};

	// 1. Convert entities to CandidateFact[] and consolidate
	const candidates: CandidateFact[] = data.entities.map((e) => ({
		type: (e.type as CandidateFact["type"]) ?? "Concept",
		name: (e.name as string) ?? "",
		content: (e.content as string) ?? "",
		summary: (e.summary as string) ?? "",
		tags: parseTags(e.tags),
		file_paths: parseFilePaths(e.file_paths),
		trust_tier: parseTrustTier(e.trust_tier),
		confidence: typeof e.confidence === "number" ? e.confidence : 0.7,
		extraction_method: (e.extraction_method as string) ?? undefined,
		t_valid_from: typeof e.t_valid_from === "number" ? e.t_valid_from : undefined,
	}));

	const consolidationResult = await consolidate(db, candidates);
	result.entitiesImported = consolidationResult.added + consolidationResult.updated;

	// 2. Import edges — only if both endpoints exist in the graph
	for (const edge of data.edges) {
		const fromId = edge.from_id as string;
		const toId = edge.to_id as string;
		if (!fromId || !toId) continue;

		const fromExists = await db.execute("SELECT 1 FROM graph_nodes WHERE id = ?", [fromId]);
		const toExists = await db.execute("SELECT 1 FROM graph_nodes WHERE id = ?", [toId]);

		if (fromExists.rows.length > 0 && toExists.rows.length > 0) {
			await db.execute(
				`INSERT INTO graph_edges (id, from_id, to_id, type, weight, confidence, trust_tier,
					t_created, t_expired, t_valid_from, t_valid_until,
					source_episode, extraction_method)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					edge.id as string,
					fromId,
					toId,
					(edge.type as string) ?? "RELATED_TO",
					typeof edge.weight === "number" ? edge.weight : 1.0,
					typeof edge.confidence === "number" ? edge.confidence : 0.7,
					typeof edge.trust_tier === "number" ? edge.trust_tier : 3,
					typeof edge.t_created === "number" ? edge.t_created : Date.now(),
					edge.t_expired ?? null,
					edge.t_valid_from ?? null,
					edge.t_valid_until ?? null,
					edge.source_episode ?? null,
					edge.extraction_method ?? null,
				],
			);
			result.edgesImported++;
		}
	}

	// 3. Import communities — INSERT OR IGNORE
	for (const community of data.communities) {
		await db.execute(
			`INSERT OR IGNORE INTO communities (id, level, parent_id, summary, member_count, package_path, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				community.id ?? null,
				community.level ?? 0,
				community.parent_id ?? null,
				community.summary ?? "",
				community.member_count ?? 0,
				community.package_path ?? null,
				community.created_at ?? Date.now(),
				community.updated_at ?? Date.now(),
			],
		);
		result.communitiesImported++;
	}

	// 4. Audit log
	await writeAuditEntry(db, "ADD", {
		extraction_method: `import:merge:${result.entitiesImported}e/${result.edgesImported}ed/${result.communitiesImported}c`,
	});

	return result;
}

// ---------------------------------------------------------------------------
// Replace mode
// ---------------------------------------------------------------------------

async function replaceImport(db: SiaDb, data: ExportData): Promise<ImportResult> {
	const result: ImportResult = {
		entitiesImported: 0,
		edgesImported: 0,
		communitiesImported: 0,
		mode: "replace",
	};

	const now = Date.now();

	await db.transaction(async (tx) => {
		// 1. Archive all currently active entities
		await tx.execute(
			"UPDATE graph_nodes SET archived_at = ? WHERE t_valid_until IS NULL AND archived_at IS NULL",
			[now],
		);

		// 2. Insert all entities from export data
		for (const e of data.entities) {
			await tx.execute(
				`INSERT INTO graph_nodes (
					id, type, name, content, summary,
					package_path, tags, file_paths,
					trust_tier, confidence, base_confidence,
					importance, base_importance,
					access_count, edge_count,
					last_accessed, created_at,
					t_created, t_expired, t_valid_from, t_valid_until,
					visibility, created_by, workspace_scope,
					hlc_created, hlc_modified, synced_at,
					conflict_group_id,
					source_episode, extraction_method, extraction_model,
					embedding, archived_at
				) VALUES (
					?, ?, ?, ?, ?,
					?, ?, ?,
					?, ?, ?,
					?, ?,
					?, ?,
					?, ?,
					?, ?, ?, ?,
					?, ?, ?,
					?, ?, ?,
					?,
					?, ?, ?,
					?, ?
				)`,
				[
					e.id as string,
					e.type as string,
					e.name as string,
					e.content as string,
					e.summary as string,
					e.package_path ?? null,
					typeof e.tags === "string" ? e.tags : JSON.stringify(e.tags ?? []),
					typeof e.file_paths === "string" ? e.file_paths : JSON.stringify(e.file_paths ?? []),
					typeof e.trust_tier === "number" ? e.trust_tier : 3,
					typeof e.confidence === "number" ? e.confidence : 0.7,
					typeof e.base_confidence === "number" ? e.base_confidence : 0.7,
					typeof e.importance === "number" ? e.importance : 0.5,
					typeof e.base_importance === "number" ? e.base_importance : 0.5,
					typeof e.access_count === "number" ? e.access_count : 0,
					typeof e.edge_count === "number" ? e.edge_count : 0,
					typeof e.last_accessed === "number" ? e.last_accessed : now,
					typeof e.created_at === "number" ? e.created_at : now,
					typeof e.t_created === "number" ? e.t_created : now,
					e.t_expired ?? null,
					e.t_valid_from ?? null,
					e.t_valid_until ?? null,
					(e.visibility as string) ?? "private",
					(e.created_by as string) ?? "local",
					e.workspace_scope ?? null,
					e.hlc_created ?? null,
					e.hlc_modified ?? null,
					e.synced_at ?? null,
					e.conflict_group_id ?? null,
					e.source_episode ?? null,
					e.extraction_method ?? null,
					e.extraction_model ?? null,
					e.embedding ?? null,
					e.archived_at ?? null,
				],
			);
			result.entitiesImported++;
		}

		// 3. Insert all edges from export data
		for (const edge of data.edges) {
			await tx.execute(
				`INSERT INTO graph_edges (id, from_id, to_id, type, weight, confidence, trust_tier,
					t_created, t_expired, t_valid_from, t_valid_until,
					source_episode, extraction_method)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					edge.id as string,
					edge.from_id as string,
					edge.to_id as string,
					(edge.type as string) ?? "RELATED_TO",
					typeof edge.weight === "number" ? edge.weight : 1.0,
					typeof edge.confidence === "number" ? edge.confidence : 0.7,
					typeof edge.trust_tier === "number" ? edge.trust_tier : 3,
					typeof edge.t_created === "number" ? edge.t_created : now,
					edge.t_expired ?? null,
					edge.t_valid_from ?? null,
					edge.t_valid_until ?? null,
					edge.source_episode ?? null,
					edge.extraction_method ?? null,
				],
			);
			result.edgesImported++;
		}

		// 4. Insert communities
		for (const community of data.communities) {
			await tx.execute(
				`INSERT INTO communities (id, level, parent_id, summary, member_count, package_path, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					community.id ?? null,
					community.level ?? 0,
					community.parent_id ?? null,
					community.summary ?? "",
					community.member_count ?? 0,
					community.package_path ?? null,
					community.created_at ?? Date.now(),
					community.updated_at ?? Date.now(),
				],
			);
			result.communitiesImported++;
		}

		// 5. Audit log
		await writeAuditEntry(tx, "ADD", {
			extraction_method: `import:replace:${result.entitiesImported}e/${result.edgesImported}ed/${result.communitiesImported}c`,
		});
	});

	return result;
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/**
 * Import graph data from a JSON file on disk.
 *
 * Reads the file, parses it as ExportData, and delegates to importGraph.
 */
export async function importFromFile(
	db: SiaDb,
	filePath: string,
	mode: "merge" | "replace",
): Promise<ImportResult> {
	const raw = readFileSync(filePath, "utf-8");
	const data = JSON.parse(raw) as ExportData;
	return importGraph(db, data, mode);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse tags from an export row — handles both JSON strings and arrays. */
function parseTags(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw as string[];
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

/** Parse file_paths from an export row — handles both JSON strings and arrays. */
function parseFilePaths(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw as string[];
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

/** Parse trust_tier ensuring it falls within the 1-4 range. */
function parseTrustTier(raw: unknown): 1 | 2 | 3 | 4 {
	if (typeof raw === "number" && raw >= 1 && raw <= 4) {
		return raw as 1 | 2 | 3 | 4;
	}
	return 3;
}
