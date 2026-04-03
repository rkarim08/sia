// Module: query-router — content classifier for routing queries to appropriate embedder

/** Content classification for routing to appropriate embedder. */
export type QueryContentType = "nl" | "code" | "mixed";

/** Patterns that indicate code-like content. */
const CODE_PATTERNS = [
	/\.[a-z]{1,4}$/,                    // file extensions (.ts, .tsx, .py) at end
	/\.[a-z]{1,4}\s/,                   // file extensions mid-sentence
	/[a-z]+\/[a-z]+/,                   // path separators (src/capture)
	/[a-z][A-Z][a-z]/,                  // camelCase (createEmbedder)
	/[A-Z][a-z]+[A-Z][a-z]/,           // PascalCase with lowercase after final upper (SiaDb, CrossEncoder)
	/\(.*\)/,                            // function calls
	/\{.*\}/,                            // object literals
	/import\s/,                          // import statements
	/require\s*\(/,                      // require calls
	/=>/,                                // arrow functions
	/[a-z]+_[a-z]+/,                    // snake_case identifiers
];

/** Code-specific keywords that should not count as plain English NL signals. */
const CODE_KEYWORDS = new Set([
	"function", "class", "const", "let", "var", "type", "interface",
	"import", "export", "return", "async", "await", "null", "true",
	"false", "void", "string", "number", "boolean", "object", "array",
	"this", "super", "typeof", "instanceof",
]);

/** Detects file extensions anywhere in the query. */
const HAS_FILE_EXT = /\.[a-z]{1,4}[\s$]|\.[a-z]{1,4}$/;

/** Patterns that indicate natural language content. */
const NL_PATTERNS = [
	/^(why|what|how|when|where|who|which|should|does|is|are|can|will|do)\s/i,
	/\?$/,                               // Questions
	/\b(the|a|an|this|that|these|those)\s/i,  // Articles
	/\b(because|since|therefore|however|although)\b/i,  // Conjunctions
	/\b(choose|chose|decision|convention|pattern|strategy|approach)\b/i,  // Domain terms
];

/**
 * Classify whether a query is code-like, natural language, or mixed.
 *
 * Used to route queries to the appropriate embedder:
 * - "nl" → bge-small only
 * - "code" → jina-code only (T1+) or bge-small (T0)
 * - "mixed" → both embedders
 *
 * Heuristic-based: counts code vs NL pattern matches.
 */
export function classifyQueryContent(query: string): QueryContentType {
	let codeScore = 0;
	let nlScore = 0;

	for (const pattern of CODE_PATTERNS) {
		if (pattern.test(query)) codeScore++;
	}

	for (const pattern of NL_PATTERNS) {
		if (pattern.test(query)) nlScore++;
	}

	// Check character composition: >30% non-alpha chars suggests code
	const nonAlpha = query.replace(/[a-zA-Z\s]/g, "").length;
	const ratio = nonAlpha / Math.max(query.length, 1);
	if (ratio > 0.3) codeScore += 2;

	// Plain English word signal: ≥2 non-code-keyword lowercase words (≥5 chars)
	// indicates natural-language context alongside any code identifiers.
	// Skipped when file extensions are present (plain words in "changes to .tsx files"
	// are code-adjacent context, not NL intent).
	if (!HAS_FILE_EXT.test(query)) {
		const plainWords = query.split(/\s+/).filter(
			(w) => w.length >= 5 && /^[a-z]+$/.test(w) && !CODE_KEYWORDS.has(w),
		);
		if (plainWords.length >= 2) nlScore++;
	}

	if (codeScore > 0 && nlScore > 0) return "mixed";
	if (codeScore > 0) return "code";
	return "nl";
}

/** Determine which embedders should be used for a given query. */
export interface EmbedderSelection {
	useNlEmbedder: boolean;
	useCodeEmbedder: boolean;
}

/**
 * Select embedders based on query content and task type.
 * Bug-fix tasks always use both embedders (bugs mix NL + code).
 */
export function selectEmbedders(
	query: string,
	taskType?: string,
): EmbedderSelection {
	// Bug-fix tasks always use both
	if (taskType === "bug-fix" || taskType === "regression") {
		return { useNlEmbedder: true, useCodeEmbedder: true };
	}

	const contentType = classifyQueryContent(query);

	switch (contentType) {
		case "code":
			return { useNlEmbedder: false, useCodeEmbedder: true };
		case "nl":
			return { useNlEmbedder: true, useCodeEmbedder: false };
		case "mixed":
			return { useNlEmbedder: true, useCodeEmbedder: true };
	}
}
