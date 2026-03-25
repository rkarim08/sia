// Module: pattern-extractor — Extracts search patterns from tool inputs for augmentation

/** Minimum pattern length to consider meaningful. */
const MIN_PATTERN_LENGTH = 3;

/**
 * Extract a search pattern from a tool call's input.
 *
 * Returns null if no meaningful pattern can be extracted or the pattern
 * is shorter than 3 characters.
 */
export function extractPattern(toolName: string, toolInput: Record<string, unknown>): string | null {
	let pattern: string | null = null;

	switch (toolName) {
		case "Grep":
			pattern = extractGrepPattern(toolInput);
			break;
		case "Glob":
			pattern = extractGlobPattern(toolInput);
			break;
		case "Bash":
			pattern = extractBashPattern(toolInput);
			break;
		default:
			return null;
	}

	if (pattern && pattern.length < MIN_PATTERN_LENGTH) {
		return null;
	}

	return pattern;
}

/** Grep: extract `pattern` field directly. */
function extractGrepPattern(toolInput: Record<string, unknown>): string | null {
	const pattern = toolInput.pattern;
	if (typeof pattern !== "string" || !pattern.trim()) {
		return null;
	}
	return pattern.trim();
}

/**
 * Glob: extract meaningful identifier from glob pattern.
 *
 * e.g. `** /auth*.ts` -> `auth`
 * Returns null for generic patterns like `** /*.ts` that have no identifier.
 */
function extractGlobPattern(toolInput: Record<string, unknown>): string | null {
	const pattern = toolInput.pattern;
	if (typeof pattern !== "string") {
		return null;
	}

	// Remove path separators, glob wildcards, and file extension
	// Extract the meaningful "name" part from patterns like **/auth*.ts
	const match = pattern.match(/(?:^|[/\\])([a-zA-Z][a-zA-Z0-9_-]*)\*?\.[a-zA-Z]+$/);
	if (match?.[1]) {
		return match[1];
	}

	// Try patterns like **/auth/**
	const dirMatch = pattern.match(/(?:^|[/\\])([a-zA-Z][a-zA-Z0-9_-]*)(?:[/\\]|\*)/);
	if (dirMatch?.[1]) {
		const candidate = dirMatch[1];
		// Skip generic directory-only globs like "src" from **/src/**
		// but keep meaningful names
		if (candidate.length >= MIN_PATTERN_LENGTH) {
			return candidate;
		}
	}

	return null;
}

/**
 * Bash: extract search pattern if command contains `rg` or `grep`.
 * Skips flags (tokens starting with -). Returns null for non-search commands.
 */
function extractBashPattern(toolInput: Record<string, unknown>): string | null {
	const command = toolInput.command;
	if (typeof command !== "string") {
		return null;
	}

	// Check if this is a rg or grep command
	const isRg = /\brg\b/.test(command);
	const isGrep = /\bgrep\b/.test(command);

	if (!isRg && !isGrep) {
		return null;
	}

	// Extract quoted patterns first (single or double quotes)
	const quotedMatch = command.match(/['"]([^'"]+)['"]/);
	if (quotedMatch?.[1]) {
		return quotedMatch[1].trim();
	}

	// Tokenize and find the first non-flag, non-command token after rg/grep
	const tokens = command.split(/\s+/);
	let foundCmd = false;
	let skipNext = false;

	// Flags that consume the next token as their argument
	const flagsWithArgs = new Set([
		"--type", "-t", "--glob", "-g", "--max-count", "-m",
		"--context", "-C", "-A", "-B", "--file", "-f",
		"--replace", "-r", "--max-depth", "-e",
	]);

	for (const token of tokens) {
		if (skipNext) {
			skipNext = false;
			continue;
		}

		if (!foundCmd) {
			if (token === "rg" || token === "grep") {
				foundCmd = true;
			}
			continue;
		}

		// Skip flags
		if (token.startsWith("-")) {
			if (flagsWithArgs.has(token)) {
				skipNext = true;
			}
			continue;
		}

		// First non-flag token after rg/grep is the pattern
		return token;
	}

	return null;
}
