// Module: markdown-import — Import markdown vault into knowledge graph

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";

export interface MarkdownImportResult {
	entitiesImported: number;
	edgesCreated: number;
	errors: string[];
}

/** Parsed markdown file with metadata and content. */
interface ParsedMarkdownFile {
	filePath: string;
	slug: string;
	frontmatter: Record<string, unknown>;
	body: string;
	heading: string | null;
	wikilinks: string[];
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Expects content to start with `---` delimiter followed by YAML key-value
 * pairs and closed with another `---`.
 *
 * Returns the parsed frontmatter object and the remaining body.
 * If no frontmatter is found, returns an empty object and the full content as body.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
	const trimmed = content.trimStart();
	if (!trimmed.startsWith("---")) {
		return { frontmatter: {}, body: content };
	}

	// Find the closing `---` (must be on its own line after the opening)
	const afterOpening = trimmed.slice(3);
	const closingIdx = afterOpening.indexOf("\n---");
	if (closingIdx === -1) {
		return { frontmatter: {}, body: content };
	}

	const yamlBlock = afterOpening.slice(0, closingIdx).trim();
	const body = afterOpening.slice(closingIdx + 4).trim();

	const frontmatter: Record<string, unknown> = {};

	for (const line of yamlBlock.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;

		const key = line.slice(0, colonIdx).trim();
		let value: unknown = line.slice(colonIdx + 1).trim();

		if (key === "" || value === "") continue;

		const strValue = value as string;

		// Parse YAML arrays: [a, b, c]
		if (strValue.startsWith("[") && strValue.endsWith("]")) {
			const inner = strValue.slice(1, -1);
			if (inner.trim() === "") {
				value = [];
			} else {
				value = inner.split(",").map((item) => parseYamlScalar(item.trim()));
			}
		} else {
			value = parseYamlScalar(strValue);
		}

		frontmatter[key] = value;
	}

	return { frontmatter, body };
}

/**
 * Parse a YAML scalar value into a JS primitive.
 * Handles numbers, booleans, null, and quoted strings.
 */
function parseYamlScalar(raw: string): string | number | boolean | null {
	// Unquote double-quoted strings
	if (raw.startsWith('"') && raw.endsWith('"')) {
		return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	// Unquote single-quoted strings
	if (raw.startsWith("'") && raw.endsWith("'")) {
		return raw.slice(1, -1);
	}
	// null / ~
	if (raw === "null" || raw === "~") return null;
	// booleans
	if (raw === "true") return true;
	if (raw === "false") return false;
	// numbers
	const num = Number(raw);
	if (!Number.isNaN(num) && raw !== "") return num;
	// fallback to string
	return raw;
}

/**
 * Extract wikilinks from markdown content.
 * Matches `[[path/slug]]` patterns and returns the link targets.
 */
function extractWikilinks(content: string): string[] {
	const regex = /\[\[([^\]]+)\]\]/g;
	const links: string[] = [];
	let match: RegExpExecArray | null;
	match = regex.exec(content);
	while (match !== null) {
		if (match[1] !== undefined) {
			links.push(match[1]);
		}
		match = regex.exec(content);
	}
	return links;
}

/**
 * Extract the first H1 heading from a markdown body.
 * Returns null if no heading is found.
 */
function extractHeading(body: string): string | null {
	const match = /^#\s+(.+)$/m.exec(body);
	return match ? (match[1]?.trim() ?? null) : null;
}

/**
 * Strip the "## Related" section from the body content so it doesn't
 * pollute the entity content.
 */
function stripRelatedSection(body: string): string {
	const relatedIdx = body.indexOf("\n## Related");
	if (relatedIdx === -1) return body;
	return body.slice(0, relatedIdx).trimEnd();
}

/**
 * Derive the entity type from the directory name of the file.
 * "decisions" -> "Decision", "bugs" -> "Bug", etc.
 * Falls back to "Concept" if the directory doesn't map to a known type.
 */
function dirToType(dirName: string): string {
	const mapping: Record<string, string> = {
		decisions: "Decision",
		conventions: "Convention",
		bugs: "Bug",
		solutions: "Solution",
		concepts: "Concept",
		code: "CodeEntity",
		files: "FileNode",
	};
	return mapping[dirName] ?? "Concept";
}

/**
 * Extract the slug portion from a wikilink target.
 * "decisions/use-jwt-rs256" -> "use-jwt-rs256"
 * "use-jwt-rs256" -> "use-jwt-rs256"
 */
function slugFromLink(link: string): string {
	const parts = link.split("/");
	return parts[parts.length - 1] ?? link;
}

/**
 * Walk a directory recursively, collecting all .md file paths.
 * Skips index.md at any level.
 */
function walkMarkdownFiles(dir: string): string[] {
	const results: string[] = [];

	if (!existsSync(dir)) return results;

	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return results;
	}

	for (const name of names) {
		const fullPath = join(dir, name);
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(fullPath);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			results.push(...walkMarkdownFiles(fullPath));
		} else if (stat.isFile() && name.endsWith(".md") && name !== "index.md") {
			results.push(fullPath);
		}
	}

	return results;
}

/**
 * Import markdown files from a vault directory into the knowledge graph.
 * Parses YAML frontmatter for metadata, markdown body for content.
 * Resolves [[wikilinks]] to graph edges.
 */
export async function importFromMarkdown(
	db: SiaDb,
	inputDir: string,
): Promise<MarkdownImportResult> {
	const errors: string[] = [];
	let entitiesImported = 0;
	let edgesCreated = 0;

	// Phase 1: Discover and parse all markdown files
	const filePaths = walkMarkdownFiles(inputDir);
	const parsed: ParsedMarkdownFile[] = [];

	for (const filePath of filePaths) {
		try {
			const raw = readFileSync(filePath, "utf-8");
			const { frontmatter, body } = parseFrontmatter(raw);

			// Determine heading: prefer extracted H1, then fall back to filename
			const heading = extractHeading(body);
			const fallbackName = basename(filePath, ".md")
				.replace(/-/g, " ")
				.replace(/\b\w/g, (c) => c.toUpperCase());

			// Determine slug from filename (without extension)
			const slug = basename(filePath, ".md");

			// Extract wikilinks from the body
			const wikilinks = extractWikilinks(body);

			parsed.push({
				filePath,
				slug,
				frontmatter,
				body,
				heading: heading ?? fallbackName,
				wikilinks,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`Failed to parse ${filePath}: ${msg}`);
		}
	}

	// Phase 2: Insert entities
	// Map slug -> entity ID for edge resolution
	const slugToId = new Map<string, string>();

	for (const file of parsed) {
		try {
			const fm = file.frontmatter;

			// Determine type from frontmatter.kind or from the parent directory name
			let type = "Concept";
			if (typeof fm.kind === "string" && fm.kind !== "") {
				type = fm.kind;
			} else {
				// Infer from parent directory
				const parentDir = basename(join(file.filePath, ".."));
				type = dirToType(parentDir);
			}

			// Clean body: strip the heading line and the related section
			let content = stripRelatedSection(file.body);
			// Remove the leading H1 heading from content since we store name separately
			content = content.replace(/^#\s+.+\n*/, "").trim();

			// Build tags
			let tags = "[]";
			if (Array.isArray(fm.tags)) {
				tags = JSON.stringify(fm.tags.map(String));
			} else if (typeof fm.tags === "string") {
				tags = fm.tags;
			}

			// Resolve trust_tier
			const trustTier = typeof fm.trust_tier === "number" ? fm.trust_tier : 1;

			// Resolve importance
			const importance = typeof fm.importance === "number" ? fm.importance : 0.5;

			// Build summary: first 150 characters of content
			const summary = content.length > 150 ? `${content.slice(0, 147)}...` : content;

			const entity = await insertEntity(db, {
				type,
				name: file.heading ?? file.slug,
				content,
				summary,
				tags,
				trust_tier: trustTier,
				importance,
				extraction_method: "markdown-import",
			});

			slugToId.set(file.slug, entity.id);
			entitiesImported++;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`Failed to import ${file.filePath}: ${msg}`);
		}
	}

	// Phase 3: Resolve wikilinks to edges
	for (const file of parsed) {
		const sourceId = slugToId.get(file.slug);
		if (!sourceId) continue;

		for (const link of file.wikilinks) {
			try {
				const targetSlug = slugFromLink(link);
				const targetId = slugToId.get(targetSlug);
				if (!targetId) continue;
				if (targetId === sourceId) continue;

				// Determine edge type from the wikilink context:
				// Look for "- {edge_type}: [[link]]" pattern
				const edgeType = resolveEdgeType(file.body, link);

				await insertEdge(db, {
					from_id: sourceId,
					to_id: targetId,
					type: edgeType,
					extraction_method: "markdown-import",
				});

				edgesCreated++;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				errors.push(`Failed to create edge from ${file.slug} -> ${link}: ${msg}`);
			}
		}
	}

	return { entitiesImported, edgesCreated, errors };
}

/**
 * Attempt to resolve the edge type from the surrounding markdown context.
 * Looks for the pattern `- {edge_type}: [[link]]` near the wikilink.
 * Falls back to "relates_to" if no pattern is found.
 */
function resolveEdgeType(body: string, link: string): string {
	// Match "- some_edge_type: [[link]]"
	const escapedLink = link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`-\\s+([\\w_]+):\\s*\\[\\[${escapedLink}\\]\\]`);
	const match = pattern.exec(body);
	if (match && match[1] !== undefined) {
		return match[1];
	}
	return "relates_to";
}
