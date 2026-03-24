// Module: sia-ast-query — MCP tool handler for tree-sitter AST queries
//
// Parses a file with tree-sitter and runs a query (symbols, imports, calls)
// against the AST. Returns structured results with bounded output.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getLanguageForFile, resolveLanguageConfig } from "@/ast/languages";
import { TreeSitterService } from "@/ast/tree-sitter/service";
import type { SiaQueryMatch } from "@/ast/tree-sitter/types";
import type { TreeSitterConfig } from "@/shared/config";

export interface SiaAstQueryInput {
	file_path: string;
	query_type: "symbols" | "imports" | "calls";
	max_results?: number;
}

export interface AstSymbol {
	name: string;
	kind: string;
	line: number;
}

export interface SiaAstQueryResult {
	file_path: string;
	language?: string;
	symbols?: AstSymbol[];
	imports?: string[];
	calls?: string[];
	error?: string;
}

const MAX_RESULTS = 100;
// Resolve grammars relative to the package root, not process.cwd()
const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAMMARS_DIR = join(__dirname, "../../..", "grammars", "queries");

const DEFAULT_TS_CONFIG: TreeSitterConfig = {
	enabled: true,
	preferNative: true,
	parseTimeoutMs: 5000,
	maxCachedTrees: 50,
	wasmDir: "",
	queryDir: "",
};

// Singleton service — avoids re-initialization on every call
let serviceInstance: TreeSitterService | null = null;

async function getService(): Promise<TreeSitterService> {
	if (!serviceInstance) {
		serviceInstance = new TreeSitterService(DEFAULT_TS_CONFIG);
		await serviceInstance.initialize();
	}
	return serviceInstance;
}

/** Dispose the singleton service and allow re-initialization on next call. */
export function resetAstQueryService(): void {
	if (serviceInstance) {
		serviceInstance.dispose();
		serviceInstance = null;
	}
}

/**
 * Extract symbols from query matches. Symbols have @name and @kind captures.
 */
export function extractSymbols(matches: SiaQueryMatch[], maxResults: number): AstSymbol[] {
	const symbols: AstSymbol[] = [];
	for (const match of matches) {
		if (symbols.length >= maxResults) break;

		let name = "";
		let kind = "";
		let line = 0;

		for (const cap of match.captures) {
			if (cap.name === "name") {
				name = cap.text;
				line = cap.startPosition.row + 1;
			} else if (cap.name === "kind" || cap.name === "definition") {
				kind = cap.text;
				line = line || cap.startPosition.row + 1;
			}
		}

		// Fall back to the first capture if no @name
		if (!name && match.captures.length > 0) {
			const first = match.captures[0];
			name = first.text;
			line = first.startPosition.row + 1;
			kind = first.name;
		}

		if (name) {
			symbols.push({ name, kind, line });
		}
	}
	return symbols;
}

/**
 * Extract import paths from query matches. Imports have @source captures.
 */
export function extractImports(matches: SiaQueryMatch[], maxResults: number): string[] {
	const imports: string[] = [];
	for (const match of matches) {
		if (imports.length >= maxResults) break;

		for (const cap of match.captures) {
			if (cap.name === "source" || cap.name === "path" || cap.name === "import") {
				// Strip quotes from import paths
				const cleaned = cap.text.replace(/^["']|["']$/g, "");
				if (cleaned && !imports.includes(cleaned)) {
					imports.push(cleaned);
				}
			}
		}
	}
	return imports;
}

/**
 * Extract call targets from query matches.
 */
export function extractCalls(matches: SiaQueryMatch[], maxResults: number): string[] {
	const calls: string[] = [];
	for (const match of matches) {
		if (calls.length >= maxResults) break;

		for (const cap of match.captures) {
			if (cap.name === "name" || cap.name === "call" || cap.name === "function") {
				if (cap.text && !calls.includes(cap.text)) {
					calls.push(cap.text);
				}
			}
		}
	}
	return calls;
}

/**
 * Parse a file with tree-sitter and extract structured AST data.
 */
export async function handleSiaAstQuery(input: SiaAstQueryInput): Promise<SiaAstQueryResult> {
	const cwd = process.cwd();
	const filePath = resolve(cwd, input.file_path);
	const maxResults = input.max_results ?? MAX_RESULTS;

	// Prevent path traversal outside the project directory
	if (!filePath.startsWith(cwd + "/") && filePath !== cwd) {
		return { file_path: input.file_path, error: "Path must be within the project directory" };
	}

	if (!existsSync(filePath)) {
		return { file_path: input.file_path, error: `File not found: ${input.file_path}` };
	}

	const langConfig = getLanguageForFile(input.file_path);
	if (!langConfig) {
		return { file_path: input.file_path, error: `Unsupported language for: ${input.file_path}` };
	}

	// Check that the query file exists for this language + query type
	const resolved = resolveLanguageConfig(langConfig);
	const queryPath = join(GRAMMARS_DIR, resolved.queryDir, `${input.query_type}.scm`);
	if (!existsSync(queryPath)) {
		return {
			file_path: input.file_path,
			language: langConfig.name,
			error: `No ${input.query_type} query available for ${langConfig.name}`,
		};
	}

	try {
		const service = await getService();
		if (service.backend === "unavailable") {
			return {
				file_path: input.file_path,
				language: langConfig.name,
				error: "Tree-sitter not available (neither native nor WASM backend loaded)",
			};
		}

		const source = readFileSync(filePath, "utf-8");
		const tree = await service.parse(source, langConfig.name);
		if (!tree) {
			return {
				file_path: input.file_path,
				language: langConfig.name,
				error: `Failed to parse ${input.file_path}`,
			};
		}

		const matches = service.query(tree, queryPath);

		const result: SiaAstQueryResult = {
			file_path: input.file_path,
			language: langConfig.name,
		};

		switch (input.query_type) {
			case "symbols":
				result.symbols = extractSymbols(matches, maxResults);
				break;
			case "imports":
				result.imports = extractImports(matches, maxResults);
				break;
			case "calls":
				result.calls = extractCalls(matches, maxResults);
				break;
		}

		return result;
	} catch (err) {
		return {
			file_path: input.file_path,
			language: langConfig.name,
			error: `AST parse error: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
