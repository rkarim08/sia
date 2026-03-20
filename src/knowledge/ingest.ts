// Module: ingest — Heading-based markdown chunking and graph ingestion

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";

/** A chunk extracted from a markdown document. */
export interface DocChunk {
	heading: string;
	headingLevel: number;
	headingPath: string[];
	content: string;
	codeBlocks: CodeBlock[];
	internalLinks: InternalLink[];
}

export interface CodeBlock {
	language: string;
	code: string;
}

export interface InternalLink {
	text: string;
	target: string;
	isAnchor: boolean;
}

export interface IngestResult {
	fileNodeId: string;
	chunksCreated: number;
	edgesCreated: number;
}

// ---------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------

/**
 * Parse markdown content into heading-based chunks.
 * Splits at heading boundaries (#, ##, ###), preserving heading hierarchy.
 * Code blocks and lists are kept intact within their heading-scoped chunks.
 */
export function parseMarkdown(content: string): DocChunk[] {
	const lines = content.split("\n");
	const chunks: DocChunk[] = [];

	// State for the current chunk being built
	let currentHeading = "";
	let currentLevel = 0;
	let headingPath: string[] = [];
	let contentLines: string[] = [];
	let inCodeFence = false;

	function flushChunk(): void {
		const body = contentLines.join("\n");
		// Only emit a chunk when there is a heading or non-empty content
		if (currentHeading !== "" || body.trim().length > 0) {
			chunks.push({
				heading: currentHeading,
				headingLevel: currentLevel,
				headingPath: [...headingPath],
				content: body.trimEnd(),
				codeBlocks: extractCodeBlocks(body),
				internalLinks: extractInternalLinks(body),
			});
		}
		contentLines = [];
	}

	for (const line of lines) {
		// Track code fences — content inside fences is never treated as headings
		if (line.trimStart().startsWith("```")) {
			inCodeFence = !inCodeFence;
			contentLines.push(line);
			continue;
		}

		if (inCodeFence) {
			contentLines.push(line);
			continue;
		}

		// Detect ATX-style headings: # H1, ## H2, ### H3 etc.
		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			// Save the previous chunk before starting a new one
			flushChunk();

			const level = headingMatch[1].length;
			const heading = headingMatch[2].trim();

			// Update heading path: keep entries up to the parent level, then add current
			headingPath = headingPath.filter((_, i) => i < level - 1);
			// Ensure path length matches: fill with empty if there are gaps
			while (headingPath.length < level - 1) {
				headingPath.push("");
			}
			headingPath[level - 1] = heading;
			headingPath = headingPath.slice(0, level);

			currentHeading = heading;
			currentLevel = level;
			continue;
		}

		contentLines.push(line);
	}

	// Flush the last chunk
	flushChunk();

	return chunks;
}

/**
 * Extract fenced code blocks from markdown content.
 * Recognises ```language ... ``` patterns.
 */
function extractCodeBlocks(content: string): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	const lines = content.split("\n");
	let inBlock = false;
	let language = "";
	let codeLines: string[] = [];

	for (const line of lines) {
		if (!inBlock && line.trimStart().startsWith("```")) {
			inBlock = true;
			language = line.trimStart().slice(3).trim();
			codeLines = [];
			continue;
		}
		if (inBlock && line.trimStart().startsWith("```")) {
			blocks.push({ language, code: codeLines.join("\n") });
			inBlock = false;
			language = "";
			codeLines = [];
			continue;
		}
		if (inBlock) {
			codeLines.push(line);
		}
	}

	return blocks;
}

/**
 * Extract internal links (markdown link syntax) from content.
 * Internal links are those whose target is a relative path or an anchor (#).
 * Absolute URLs (http://, https://) are excluded.
 */
function extractInternalLinks(content: string): InternalLink[] {
	const links: InternalLink[] = [];
	const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
	let match = linkRegex.exec(content);

	while (match !== null) {
		const text = match[1];
		const target = match[2];

		// Skip absolute URLs
		if (!/^https?:\/\//.test(target)) {
			links.push({
				text,
				target,
				isAnchor: target.startsWith("#"),
			});
		}

		match = linkRegex.exec(content);
	}

	return links;
}

// ---------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------

/**
 * Parse YAML frontmatter from markdown content.
 * Returns the frontmatter as key-value pairs and the remaining content.
 */
export function parseFrontmatter(content: string): {
	frontmatter: Record<string, string>;
	body: string;
} {
	const frontmatter: Record<string, string> = {};

	if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
		return { frontmatter, body: content };
	}

	// Find the closing delimiter
	const endIdx = content.indexOf("\n---", 4);
	if (endIdx === -1) {
		return { frontmatter, body: content };
	}

	const yamlBlock = content.slice(4, endIdx);
	// Skip past the closing ---\n
	const bodyStart = content.indexOf("\n", endIdx + 1);
	const body = bodyStart === -1 ? "" : content.slice(bodyStart + 1);

	// Simple key: value parser (no nested YAML)
	for (const line of yamlBlock.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;

		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) continue;

		const key = trimmed.slice(0, colonIdx).trim();
		const value = trimmed.slice(colonIdx + 1).trim();
		if (key) {
			frontmatter[key] = value;
		}
	}

	return { frontmatter, body };
}

// ---------------------------------------------------------------
// Graph ingestion
// ---------------------------------------------------------------

/**
 * Ingest a documentation file into the knowledge graph.
 *
 * 1. Create or reuse a FileNode entity for the file
 * 2. Parse the markdown into chunks
 * 3. Create ContentChunk entities for each chunk
 * 4. Create child_of edges from chunks to the FileNode
 * 5. Resolve internal links to references edges
 */
export async function ingestDocument(
	db: SiaDb,
	filePath: string,
	relativePath: string,
	opts?: {
		tag?: string;
		trustTier?: 1 | 2;
		packagePath?: string | null;
	},
): Promise<IngestResult> {
	const raw = readFileSync(filePath, "utf-8");
	const { frontmatter, body } = parseFrontmatter(raw);
	const chunks = parseMarkdown(body);

	const tag = opts?.tag ?? "project-docs";
	const trustTier = opts?.trustTier ?? 1;
	const packagePath = opts?.packagePath ?? null;
	const fileName = basename(relativePath);

	let edgesCreated = 0;

	// ---- Step 1: Find or create FileNode ----
	let fileNodeId: string;

	const existing = await db.execute(
		"SELECT id FROM graph_nodes WHERE type = 'FileNode' AND file_paths LIKE ? AND t_valid_until IS NULL AND archived_at IS NULL",
		[`%"${relativePath}"%`],
	);

	if (existing.rows.length > 0) {
		fileNodeId = existing.rows[0].id as string;
	} else {
		const summary = frontmatter.description ?? frontmatter.title ?? raw.slice(0, 200).trim();

		const fileNode = await insertEntity(db, {
			type: "FileNode",
			name: fileName,
			content: summary,
			summary: `Documentation file: ${relativePath}`,
			package_path: packagePath,
			tags: JSON.stringify([tag]),
			file_paths: JSON.stringify([relativePath]),
			trust_tier: trustTier,
			confidence: 1.0,
			extraction_method: "document-ingest",
		});
		fileNodeId = fileNode.id;
	}

	// ---- Step 2-4: Create ContentChunk entities and child_of edges ----
	let chunksCreated = 0;

	for (const chunk of chunks) {
		const chunkName = chunk.heading !== "" ? chunk.heading : `${fileName} - Introduction`;

		const contentPreview = chunk.content.slice(0, 150).trim();

		const chunkTags: string[] = [tag];
		if (chunk.headingLevel > 0) {
			chunkTags.push(`h${chunk.headingLevel}`);
		}

		const chunkEntity = await insertEntity(db, {
			type: "ContentChunk",
			name: chunkName,
			content: chunk.content,
			summary: contentPreview,
			package_path: packagePath,
			tags: JSON.stringify(chunkTags),
			file_paths: JSON.stringify([relativePath]),
			trust_tier: trustTier,
			confidence: 1.0,
			extraction_method: "document-ingest",
		});

		// child_of edge: chunk -> FileNode
		await insertEdge(db, {
			from_id: chunkEntity.id,
			to_id: fileNodeId,
			type: "child_of",
			extraction_method: "document-ingest",
		});
		edgesCreated++;
		chunksCreated++;
	}

	return {
		fileNodeId,
		chunksCreated,
		edgesCreated,
	};
}
