import { describe, expect, it } from "vitest";
import { sanitizeFlagReason, sanitizePromptInput, sanitizeText } from "@/security/sanitize";

describe("sanitizeText", () => {
	it("strips control characters except newline and tab", () => {
		const input = "hello\x00world\x01foo\x1Fbar";
		const result = sanitizeText(input);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — asserting control chars were removed
		expect(result).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
		expect(result).toContain("hello");
		expect(result).toContain("world");
	});

	it("preserves newlines and tabs", () => {
		const input = "line1\nline2\ttabbed";
		const result = sanitizeText(input);
		expect(result).toContain("\n");
		expect(result).toContain("\t");
	});

	it("collapses runs of spaces", () => {
		const input = "too   many    spaces";
		const result = sanitizeText(input);
		expect(result).toBe("too many spaces");
	});

	it("truncates at word boundary", () => {
		const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
		const result = sanitizeText(words, 100);
		expect(result.length).toBeLessThanOrEqual(100);
		// Should end at a word boundary (no partial word cut)
		expect(result).not.toMatch(/\s$/);
	});

	it("truncates hard when no suitable word boundary exists", () => {
		const longWord = "a".repeat(200);
		const result = sanitizeText(longWord, 100);
		expect(result.length).toBeLessThanOrEqual(100);
	});

	it("returns empty string for empty string input", () => {
		expect(sanitizeText("")).toBe("");
	});

	it("returns empty string for falsy values cast to string", () => {
		// @ts-expect-error testing runtime behavior with null
		expect(sanitizeText(null)).toBe("");
		// @ts-expect-error testing runtime behavior with undefined
		expect(sanitizeText(undefined)).toBe("");
	});

	it("respects default 2000 char max length", () => {
		const longText = "word ".repeat(1000); // 5000 chars
		const result = sanitizeText(longText);
		expect(result.length).toBeLessThanOrEqual(2000);
	});
});

describe("sanitizeFlagReason", () => {
	it("enforces 100 char limit", () => {
		const longReason = "a".repeat(200);
		const result = sanitizeFlagReason(longReason);
		expect(result.length).toBeLessThanOrEqual(100);
	});

	it("strips backticks", () => {
		const input = "reason with `backticks` here";
		const result = sanitizeFlagReason(input);
		expect(result).not.toContain("`");
		expect(result).toContain("reason with");
	});

	it("strips angle brackets", () => {
		const input = "reason <with> angle <brackets>";
		const result = sanitizeFlagReason(input);
		expect(result).not.toContain("<");
		expect(result).not.toContain(">");
	});

	it("strips curly braces", () => {
		const input = "reason {with} curly {braces}";
		const result = sanitizeFlagReason(input);
		expect(result).not.toContain("{");
		expect(result).not.toContain("}");
	});

	it("returns empty string when nothing remains after stripping", () => {
		const input = "```{}<>";
		const result = sanitizeFlagReason(input);
		expect(result).toBe("");
	});

	it("returns empty string for empty input", () => {
		expect(sanitizeFlagReason("")).toBe("");
	});
});

describe("sanitizePromptInput", () => {
	it("escapes triple-star delimiters (*** → * * *)", () => {
		const input = "some ***bold*** text";
		const result = sanitizePromptInput(input);
		expect(result).not.toContain("***");
		expect(result).toContain("* * *");
	});

	it("escapes triple-backtick delimiters (``` → ` ` `)", () => {
		const input = "code block:\n```\nconst x = 1;\n```";
		const result = sanitizePromptInput(input);
		expect(result).not.toContain("```");
		expect(result).toContain("` ` `");
	});

	it("escapes heredoc open markers (<< → < <)", () => {
		const input = "heredoc <<EOF\nsome content\nEOF";
		const result = sanitizePromptInput(input);
		expect(result).not.toContain("<<");
		expect(result).toContain("< <");
	});

	it("escapes heredoc close markers (>> → > >)", () => {
		const input = "output >> /dev/null";
		const result = sanitizePromptInput(input);
		expect(result).not.toContain(">>");
		expect(result).toContain("> >");
	});

	it("enforces 5000 char limit", () => {
		const longText = "word ".repeat(2000); // 10000 chars
		const result = sanitizePromptInput(longText);
		expect(result.length).toBeLessThanOrEqual(5000);
	});

	it("returns empty string for empty input", () => {
		expect(sanitizePromptInput("")).toBe("");
	});
});
