// Module: templates — .sia/templates/ loader and validator for knowledge authoring

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface TemplateField {
	description: string;
	required: boolean;
}

export interface KnowledgeTemplate {
	name: string;
	kind: string;
	fields: Record<string, TemplateField>;
	tagsPrefix: string[];
	autoRelate: boolean;
}

/**
 * Load all templates from a .sia/templates/ directory.
 * Templates are YAML files defining structured fields for knowledge entry.
 *
 * Returns a map of template name -> template definition.
 */
export function loadTemplates(siaDir: string): Map<string, KnowledgeTemplate> {
	const templates = new Map<string, KnowledgeTemplate>();
	const templatesDir = join(siaDir, "templates");

	if (!existsSync(templatesDir)) {
		return templates;
	}

	let entries: string[];
	try {
		entries = readdirSync(templatesDir);
	} catch {
		return templates;
	}

	for (const entry of entries) {
		if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) {
			continue;
		}

		const filePath = join(templatesDir, entry);
		let content: string;
		try {
			content = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const parsed = parseSimpleYaml(content);
		const name = basename(entry).replace(/\.ya?ml$/, "");

		const rawFields = parsed.fields as Record<string, Record<string, unknown>> | undefined;
		const fields: Record<string, TemplateField> = {};

		if (rawFields && typeof rawFields === "object") {
			for (const [fieldName, fieldDef] of Object.entries(rawFields)) {
				if (fieldDef && typeof fieldDef === "object") {
					fields[fieldName] = {
						description: String(fieldDef.description ?? ""),
						required: fieldDef.required === true,
					};
				}
			}
		}

		const rawTagsPrefix = parsed.tags_prefix;
		let tagsPrefix: string[] = [];
		if (Array.isArray(rawTagsPrefix)) {
			tagsPrefix = rawTagsPrefix.map(String);
		}

		const template: KnowledgeTemplate = {
			name,
			kind: String(parsed.kind ?? ""),
			fields,
			tagsPrefix,
			autoRelate: parsed.auto_relate === true,
		};

		templates.set(name, template);
	}

	return templates;
}

/**
 * Validate properties against a template's required fields.
 * Returns an array of error messages (empty if valid).
 */
export function validateTemplate(
	template: KnowledgeTemplate,
	properties: Record<string, unknown>,
): string[] {
	const errors: string[] = [];

	for (const [fieldName, field] of Object.entries(template.fields)) {
		if (!field.required) {
			continue;
		}

		const value = properties[fieldName];
		if (value === undefined || value === null || value === "") {
			errors.push(`Missing required field "${fieldName}": ${field.description}`);
		}
	}

	return errors;
}

/**
 * Get a specific template by name.
 * Returns undefined if not found.
 */
export function getTemplate(
	templates: Map<string, KnowledgeTemplate>,
	name: string,
): KnowledgeTemplate | undefined {
	return templates.get(name);
}

/**
 * Simple YAML parser for template files.
 * Handles the subset of YAML used by templates (flat and one-level nested objects).
 *
 * Supported syntax:
 * - Top-level `key: value` pairs
 * - Nested objects (2-space or tab indented)
 * - Inline arrays `[item1, item2]`
 * - Boolean values (true/false)
 * - Quoted and unquoted string values
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = content.split("\n");

	let i = 0;
	while (i < lines.length) {
		const line = lines[i] as string;

		// Skip empty lines and comments
		if (line.trim() === "" || line.trim().startsWith("#")) {
			i++;
			continue;
		}

		// Top-level key: must start at column 0 (no indentation)
		if (line[0] !== " " && line[0] !== "\t") {
			const colonIdx = line.indexOf(":");
			if (colonIdx === -1) {
				i++;
				continue;
			}

			const key = line.slice(0, colonIdx).trim();
			const rawValue = line.slice(colonIdx + 1).trim();

			if (rawValue === "") {
				// This is a nested object — collect indented lines
				const nested: Record<string, unknown> = {};
				i++;
				const nestedResult = parseNestedBlock(lines, i);
				Object.assign(nested, nestedResult.data);
				i = nestedResult.nextIndex;
				result[key] = nested;
			} else {
				result[key] = parseValue(rawValue);
				i++;
			}
		} else {
			// Indented line at top level — skip (shouldn't happen in well-formed input)
			i++;
		}
	}

	return result;
}

/**
 * Parse a block of indented lines as a nested object.
 * Handles one-level nesting (fields with sub-properties).
 */
function parseNestedBlock(
	lines: string[],
	startIdx: number,
): { data: Record<string, unknown>; nextIndex: number } {
	const data: Record<string, unknown> = {};
	let i = startIdx;

	while (i < lines.length) {
		const line = lines[i] as string;

		// Empty line — continue (might be within the block)
		if (line.trim() === "" || line.trim().startsWith("#")) {
			i++;
			continue;
		}

		// Check if this line is indented (part of the block)
		if (line[0] !== " " && line[0] !== "\t") {
			// Back at top level — stop
			break;
		}

		const indent = getIndentLevel(line);
		const trimmed = line.trim();

		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) {
			i++;
			continue;
		}

		const key = trimmed.slice(0, colonIdx).trim();
		const rawValue = trimmed.slice(colonIdx + 1).trim();

		if (rawValue === "") {
			// Sub-nested object (second level)
			const subNested: Record<string, unknown> = {};
			i++;

			while (i < lines.length) {
				const subLine = lines[i] as string;
				if (subLine.trim() === "" || subLine.trim().startsWith("#")) {
					i++;
					continue;
				}

				const subIndent = getIndentLevel(subLine);
				if (subIndent <= indent) {
					break;
				}

				const subTrimmed = subLine.trim();
				const subColonIdx = subTrimmed.indexOf(":");
				if (subColonIdx !== -1) {
					const subKey = subTrimmed.slice(0, subColonIdx).trim();
					const subRawValue = subTrimmed.slice(subColonIdx + 1).trim();
					subNested[subKey] = parseValue(subRawValue);
				}
				i++;
			}

			data[key] = subNested;
		} else {
			data[key] = parseValue(rawValue);
			i++;
		}
	}

	return { data, nextIndex: i };
}

/** Determine the indentation level of a line (number of leading spaces/tabs). */
function getIndentLevel(line: string): number {
	let count = 0;
	for (const ch of line) {
		if (ch === " ") {
			count++;
		} else if (ch === "\t") {
			count += 2;
		} else {
			break;
		}
	}
	return count;
}

/** Parse a scalar or inline-array YAML value. */
function parseValue(raw: string): unknown {
	// Remove trailing comments
	const commentIdx = raw.indexOf(" #");
	const cleaned = commentIdx !== -1 ? raw.slice(0, commentIdx).trim() : raw;

	// Boolean
	if (cleaned === "true") return true;
	if (cleaned === "false") return false;

	// Null
	if (cleaned === "null" || cleaned === "~") return null;

	// Inline array: [item1, item2]
	if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
		const inner = cleaned.slice(1, -1).trim();
		if (inner === "") return [];
		return inner.split(",").map((item) => parseValue(item.trim()));
	}

	// Quoted string
	if (
		(cleaned.startsWith('"') && cleaned.endsWith('"')) ||
		(cleaned.startsWith("'") && cleaned.endsWith("'"))
	) {
		return cleaned.slice(1, -1);
	}

	// Number
	if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
		return Number(cleaned);
	}

	// Plain string
	return cleaned;
}
