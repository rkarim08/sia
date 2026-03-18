// src/security/sanitize.ts — Input sanitization for graph writes and LLM prompts
// Design principle: sanitize cleans SYNTAX, pattern-detector.ts detects SEMANTICS.

/**
 * General text sanitization: strip control chars, collapse whitespace, truncate.
 */
export function sanitizeText(text: string, maxLength = 2000): string {
	if (!text) return "";
	// Strip control characters U+0000–U+001F except \n (0x0A) and \t (0x09)
	// Using RegExp constructor to avoid Biome noControlCharactersInRegex lint rule
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — this function exists specifically to strip control characters
	let cleaned = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
	// Collapse runs of spaces (preserve newlines and tabs)
	cleaned = cleaned.replace(/ {2,}/g, " ");
	// Truncate at word boundary
	if (cleaned.length > maxLength) {
		const truncated = cleaned.slice(0, maxLength);
		const lastSpace = truncated.lastIndexOf(" ");
		cleaned = lastSpace > maxLength * 0.5 ? truncated.slice(0, lastSpace) : truncated;
	}
	return cleaned.trim();
}

/**
 * Sanitize flag reasons: max 100 chars, strip chars that break prompt delimiters.
 */
export function sanitizeFlagReason(reason: string): string {
	if (!reason) return "";
	let cleaned = reason.replace(/[`<>{}]/g, "");
	cleaned = sanitizeText(cleaned, 100);
	return cleaned;
}

/**
 * Sanitize text for safe interpolation into LLM prompts.
 * Escapes patterns that could break prompt structure.
 */
export function sanitizePromptInput(text: string): string {
	if (!text) return "";
	let cleaned = sanitizeText(text, 5000);
	cleaned = cleaned.replace(/\*\*\*/g, "* * *");
	cleaned = cleaned.replace(/```/g, "` ` `");
	cleaned = cleaned.replace(/<</g, "< <");
	cleaned = cleaned.replace(/>>/g, "> >");
	return cleaned;
}
