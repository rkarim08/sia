// Module: markdown-export — Export knowledge graph as markdown vault

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SiaDb } from "@/graph/db-interface";

export interface MarkdownExportOpts {
	outputDir: string;
	types?: string[];
	includeCode?: boolean;
}

export interface MarkdownExportResult {
	filesWritten: number;
	entitiesExported: number;
	outputDir: string;
}

/** Default semantic entity types to export (excludes CodeEntity and FileNode). */
const DEFAULT_TYPES = ["Decision", "Convention", "Bug", "Solution", "Concept"];

/** Related entity info resolved from edges. */
interface RelatedEntity {
	edgeType: string;
	id: string;
	entityType: string;
	name: string;
}

/**
 * Convert entity type to directory name.
 * "Decision" -> "decisions", "CodeEntity" -> "code", etc.
 */
function typeToDir(type: string): string {
	if (type === "CodeEntity") return "code";
	if (type === "FileNode") return "files";
	return `${type.toLowerCase()}s`;
}

/**
 * Slugify a name for use as a filename.
 * Lowercases, replaces whitespace/underscores with hyphens,
 * strips non-alphanumeric characters (except hyphens), and collapses
 * multiple consecutive hyphens.
 */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Format a millisecond epoch timestamp as an ISO 8601 date string.
 * Returns "unknown" if the timestamp is null or undefined.
 */
function toIsoDate(ts: number | null | undefined): string {
	if (ts == null || ts === 0) return "unknown";
	return new Date(ts).toISOString();
}

/**
 * Parse a JSON tags string into an array of strings.
 * Returns empty array for any parse failure.
 */
function parseTags(tags: unknown): string[] {
	if (typeof tags !== "string") return [];
	try {
		const parsed = JSON.parse(tags);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

/**
 * Escape YAML string values that may contain special characters.
 * Wraps in double quotes if necessary.
 */
function yamlString(value: string): string {
	if (/[:#{}[\],&*?|>!%@`]/.test(value) || value.includes('"') || value.includes("'")) {
		return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return value;
}

/**
 * Export knowledge graph entities as markdown files organized by type.
 * Each entity becomes a markdown file with YAML frontmatter.
 * Wikilinks connect related entities for Obsidian compatibility.
 */
export async function exportAsMarkdown(
	db: SiaDb,
	opts: MarkdownExportOpts,
): Promise<MarkdownExportResult> {
	const types = opts.types ?? DEFAULT_TYPES;
	const includeCode = opts.includeCode ?? false;

	// Build the effective type list
	const effectiveTypes = [...types];
	if (includeCode && !effectiveTypes.includes("CodeEntity")) {
		effectiveTypes.push("CodeEntity");
	}

	// Query active entities filtered by type
	const placeholders = effectiveTypes.map(() => "?").join(", ");
	const { rows: entityRows } = await db.execute(
		`SELECT id, type, name, content, summary, importance, trust_tier, tags, created_at, t_valid_from
		 FROM graph_nodes
		 WHERE t_valid_until IS NULL AND archived_at IS NULL
		   AND type IN (${placeholders})
		 ORDER BY type, importance DESC`,
		effectiveTypes,
	);

	// Create output directory structure
	mkdirSync(opts.outputDir, { recursive: true });
	const dirsCreated = new Set<string>();
	for (const t of effectiveTypes) {
		const dir = join(opts.outputDir, typeToDir(t));
		mkdirSync(dir, { recursive: true });
		dirsCreated.add(dir);
	}

	// For each entity, resolve related entities and write markdown file
	let filesWritten = 0;
	const typeCounts = new Map<string, number>();

	for (const row of entityRows) {
		const entity = row as Record<string, unknown>;
		const entityId = entity.id as string;
		const entityType = entity.type as string;
		const entityName = entity.name as string;
		const entityContent = entity.content as string;
		const trustTier = entity.trust_tier as number;
		const createdAt = entity.created_at as number | null;
		const tags = parseTags(entity.tags);
		const importance = entity.importance as number;

		// Track type counts for index
		typeCounts.set(entityType, (typeCounts.get(entityType) ?? 0) + 1);

		// Resolve related entities via outgoing edges
		const { rows: relatedRows } = await db.execute(
			`SELECT e.type AS edge_type, ent.id, ent.type AS entity_type, ent.name
			 FROM graph_edges e
			 JOIN graph_nodes ent ON ent.id = e.to_id
			 WHERE e.from_id = ? AND e.t_valid_until IS NULL
			   AND ent.t_valid_until IS NULL AND ent.archived_at IS NULL`,
			[entityId],
		);

		const related: RelatedEntity[] = (relatedRows as Record<string, unknown>[]).map((r) => ({
			edgeType: r.edge_type as string,
			id: r.id as string,
			entityType: r.entity_type as string,
			name: r.name as string,
		}));

		// Build YAML frontmatter
		const tagsYaml = tags.length > 0 ? `[${tags.map((t) => yamlString(t)).join(", ")}]` : "[]";

		const lines: string[] = [
			"---",
			`id: ${yamlString(entityId)}`,
			`kind: ${entityType}`,
			`trust_tier: ${trustTier}`,
			`created_at: ${yamlString(toIsoDate(createdAt))}`,
			`tags: ${tagsYaml}`,
			`importance: ${importance}`,
			"---",
			"",
			`# ${entityName}`,
			"",
			entityContent,
		];

		// Add related section if there are linked entities
		if (related.length > 0) {
			lines.push("", "## Related", "");
			for (const rel of related) {
				const targetDir = typeToDir(rel.entityType);
				const targetSlug = slugify(rel.name);
				lines.push(`- ${rel.edgeType}: [[${targetDir}/${targetSlug}]]`);
			}
		}

		lines.push(""); // trailing newline

		// Write file
		const dir = typeToDir(entityType);
		const filename = `${slugify(entityName)}.md`;
		const filePath = join(opts.outputDir, dir, filename);
		writeFileSync(filePath, lines.join("\n"), "utf-8");
		filesWritten++;
	}

	// Generate index.md
	const indexLines: string[] = [
		"# Sia Knowledge Graph Export",
		"",
		`**Exported at:** ${new Date().toISOString()}`,
		`**Entities:** ${entityRows.length}`,
		"",
		"## Summary",
		"",
		"| Type | Count |",
		"|------|-------|",
	];

	for (const t of effectiveTypes) {
		const count = typeCounts.get(t) ?? 0;
		if (count > 0) {
			indexLines.push(`| ${t} | ${count} |`);
		}
	}

	indexLines.push(""); // trailing newline
	writeFileSync(join(opts.outputDir, "index.md"), indexLines.join("\n"), "utf-8");
	filesWritten++;

	return {
		filesWritten,
		entitiesExported: entityRows.length,
		outputDir: opts.outputDir,
	};
}
