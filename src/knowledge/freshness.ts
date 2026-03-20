// Module: freshness — Documentation freshness tracking via git metadata

import { execSync } from "node:child_process";
import type { SiaDb } from "@/graph/db-interface";
import { updateEntity } from "@/graph/entities";

export interface FreshnessResult {
	entityId: string;
	filePath: string;
	docModifiedAt: number | null;
	codeModifiedAt: number | null;
	divergenceDays: number | null;
	isStale: boolean;
}

export interface FreshnessConfig {
	divergenceThreshold: number;
	freshnessPenalty: number;
}

export const DEFAULT_FRESHNESS_CONFIG: FreshnessConfig = {
	divergenceThreshold: 90,
	freshnessPenalty: 0.15,
};

/** Documentation tags that identify FileNode entities as documentation. */
const DOC_TAGS = ["ai-context", "architecture", "project-docs", "api-docs", "changelog"];

/**
 * Get the last git modification date for a file.
 * Returns Unix milliseconds or null if not tracked.
 *
 * Note: Uses execSync with git CLI. The filePath argument comes from Sia's
 * internal graph database (entity file_paths column), not from external user
 * input, so shell injection risk is minimal. The path is quoted in the command.
 */
export function getGitModifiedAt(repoRoot: string, filePath: string): number | null {
	try {
		const output = execSync(`git log -1 --format=%at -- "${filePath}"`, {
			cwd: repoRoot,
			encoding: "utf-8",
			timeout: 5000,
		}).trim();
		if (!output) return null;
		return Number.parseInt(output, 10) * 1000;
	} catch {
		return null;
	}
}

/**
 * Check freshness of a documentation FileNode by comparing its last git modification
 * date to the most recent modification of code files it references.
 *
 * Does NOT modify the database — returns freshness info for the caller to act on.
 */
export function checkDocFreshness(
	repoRoot: string,
	docFilePath: string,
	referencedFilePaths: string[],
	config?: FreshnessConfig,
): FreshnessResult {
	const cfg = config ?? DEFAULT_FRESHNESS_CONFIG;
	const docModifiedAt = getGitModifiedAt(repoRoot, docFilePath);

	if (docModifiedAt === null || referencedFilePaths.length === 0) {
		return {
			entityId: "",
			filePath: docFilePath,
			docModifiedAt,
			codeModifiedAt: null,
			divergenceDays: null,
			isStale: false,
		};
	}

	let latestCodeModified: number | null = null;
	for (const codePath of referencedFilePaths) {
		const ts = getGitModifiedAt(repoRoot, codePath);
		if (ts !== null && (latestCodeModified === null || ts > latestCodeModified)) {
			latestCodeModified = ts;
		}
	}

	if (latestCodeModified === null) {
		return {
			entityId: "",
			filePath: docFilePath,
			docModifiedAt,
			codeModifiedAt: null,
			divergenceDays: null,
			isStale: false,
		};
	}

	const msPerDay = 86_400_000;
	const divergenceDays = (latestCodeModified - docModifiedAt) / msPerDay;
	const isStale = divergenceDays > 0 && divergenceDays > cfg.divergenceThreshold;

	return {
		entityId: "",
		filePath: docFilePath,
		docModifiedAt,
		codeModifiedAt: latestCodeModified,
		divergenceDays,
		isStale,
	};
}

/**
 * Run freshness check on all documentation FileNodes in the graph that have
 * reference edges to code entities.
 *
 * Returns freshness results for all checked documents.
 * Optionally applies freshness penalty to stale documents.
 */
export async function checkAllDocFreshness(
	db: SiaDb,
	repoRoot: string,
	config?: FreshnessConfig,
	opts?: { applyPenalty?: boolean },
): Promise<FreshnessResult[]> {
	const cfg = config ?? DEFAULT_FRESHNESS_CONFIG;

	// Build the LIKE conditions for documentation tags
	const tagConditions = DOC_TAGS.map((tag) => `tags LIKE '%${tag}%'`).join(" OR ");

	const docRows = await db.execute(
		`SELECT id, file_paths, tags, importance FROM graph_nodes
		 WHERE type = 'FileNode'
		   AND (${tagConditions})
		   AND t_valid_until IS NULL AND archived_at IS NULL`,
	);

	const results: FreshnessResult[] = [];

	for (const row of docRows.rows) {
		const entityId = row.id as string;
		const filePaths = parseJsonArray(row.file_paths as string);
		const importance = row.importance as number;

		if (filePaths.length === 0) continue;

		const docFilePath = filePaths[0] as string;

		// Find referenced code files via edges
		const referencedPaths = await getReferencedCodePaths(db, entityId);

		const result = checkDocFreshness(repoRoot, docFilePath, referencedPaths, cfg);
		result.entityId = entityId;

		if (opts?.applyPenalty && result.isStale) {
			const currentTags = parseJsonArray(row.tags as string);
			if (!currentTags.includes("potentially-stale")) {
				currentTags.push("potentially-stale");
			}
			const newImportance = Math.max(0.01, importance - cfg.freshnessPenalty);
			await updateEntity(db, entityId, {
				tags: JSON.stringify(currentTags),
				importance: newImportance,
			});
		}

		results.push(result);
	}

	return results;
}

/**
 * Find all code file paths referenced by a documentation entity via edges.
 * Includes both direct edges and edges from ContentChunk children.
 */
async function getReferencedCodePaths(db: SiaDb, docEntityId: string): Promise<string[]> {
	// Direct edges from the doc entity to code entities
	const directResult = await db.execute(
		`SELECT DISTINCT e2.file_paths FROM graph_edges ed
		 JOIN graph_nodes e2 ON e2.id = ed.to_id
		 WHERE ed.from_id = ? AND ed.t_valid_until IS NULL
		   AND e2.type IN ('CodeEntity', 'FileNode')
		   AND e2.t_valid_until IS NULL AND e2.archived_at IS NULL`,
		[docEntityId],
	);

	// Edges from ContentChunk children of this doc entity
	const chunkResult = await db.execute(
		`SELECT DISTINCT e3.file_paths FROM graph_edges parent_edge
		 JOIN graph_nodes chunk ON chunk.id = parent_edge.to_id
		 JOIN graph_edges child_edge ON child_edge.from_id = chunk.id
		 JOIN graph_nodes e3 ON e3.id = child_edge.to_id
		 WHERE parent_edge.from_id = ? AND parent_edge.t_valid_until IS NULL
		   AND chunk.type = 'ContentChunk'
		   AND chunk.t_valid_until IS NULL AND chunk.archived_at IS NULL
		   AND child_edge.t_valid_until IS NULL
		   AND e3.type IN ('CodeEntity', 'FileNode')
		   AND e3.t_valid_until IS NULL AND e3.archived_at IS NULL`,
		[docEntityId],
	);

	const paths = new Set<string>();

	for (const row of [...directResult.rows, ...chunkResult.rows]) {
		const filePaths = parseJsonArray(row.file_paths as string);
		for (const p of filePaths) {
			paths.add(p);
		}
	}

	return [...paths];
}

/** Safely parse a JSON string array, returning [] on failure. */
function parseJsonArray(json: string): string[] {
	try {
		const parsed: unknown = JSON.parse(json);
		if (Array.isArray(parsed)) return parsed as string[];
		return [];
	} catch {
		return [];
	}
}
