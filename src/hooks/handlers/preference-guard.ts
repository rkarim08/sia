// Module: hooks/handlers/preference-guard — PreToolUse enforcement for Tier-1 Preferences
//
// Makes Tier-1 Preferences enforcing rather than advisory. Runs on every PreToolUse
// event for Bash|Write|Edit, pulls the active Tier-1 Preference nodes via the cache,
// and denies the tool call when the developer's preference text contains a
// prohibition (never X / do not X / don't X) whose object appears in the tool
// call's command or file contents.
//
// Conservative by design:
//   - Only acts on explicit prohibition patterns.
//   - Returns null (no intervention) on unmatched, ambiguous, or errored inputs.
//   - Never throws — DB/regex errors degrade to null (fail open, never fail closed).
//   - Only Tier-1 Preferences enforce. Tier-2+ is advisory and ignored here.

import type { SiaDb } from "@/graph/db-interface";
import { getActiveTier1Preferences, type Tier1Preference } from "@/hooks/preference-cache";
import type { HookEvent } from "@/hooks/types";

export interface PreferenceGuardDenyResponse {
	hookSpecificOutput: {
		hookEventName: "PreToolUse";
		permissionDecision: "deny";
		permissionDecisionReason: string;
	};
}

const ENFORCED_TOOLS: ReadonlySet<string> = new Set(["Bash", "Write", "Edit"]);

// Capture the object of a prohibition clause, trimmed at sentence boundaries so
// we match phrases, not whole paragraphs.
const PROHIBITION_PATTERNS: ReadonlyArray<RegExp> = [
	/\bnever\s+([^.!?\n]+)/gi,
	/\bdo\s+not\s+([^.!?\n]+)/gi,
	/\bdon['’]?t\s+([^.!?\n]+)/gi,
];

/**
 * Extract tool-call text that should be matched against prohibitions.
 */
function extractToolText(event: HookEvent): string {
	const input = event.tool_input ?? {};
	if (event.tool_name === "Bash") {
		const cmd = input.command;
		return typeof cmd === "string" ? cmd : "";
	}
	if (event.tool_name === "Write" || event.tool_name === "Edit") {
		const filePath = typeof input.file_path === "string" ? input.file_path : "";
		const contentRaw =
			(typeof input.content === "string" && input.content) ||
			(typeof input.new_string === "string" && input.new_string) ||
			"";
		const snippet = contentRaw.slice(0, 500);
		return `${filePath}\n${snippet}`;
	}
	return "";
}

function normalise(s: string): string {
	return s.toLowerCase();
}

// Stop-words stripped from a prohibition clause before keyword matching. Keeping
// this deliberately short — a prohibition like "commit to main" should reduce to
// the keywords {commit, main}, and we then require all keywords to appear in
// the tool text. This preserves specificity while tolerating flag-or-message
// variants (e.g. `git commit -m 'hotfix on main'`).
const STOPWORDS: ReadonlySet<string> = new Set([
	"a",
	"an",
	"the",
	"to",
	"on",
	"in",
	"of",
	"for",
	"at",
	"by",
	"with",
	"and",
	"or",
	"not",
	"is",
	"are",
	"be",
	"as",
	"into",
	"onto",
	"from",
	"it",
	"this",
	"that",
	"these",
	"those",
]);

/**
 * Given a Preference's content (free text), return the prohibition objects it
 * expresses. Empty when no recognised pattern matches.
 */
export function extractProhibitions(content: string): string[] {
	if (!content) return [];
	const results: string[] = [];
	for (const pattern of PROHIBITION_PATTERNS) {
		const re = new RegExp(pattern.source, pattern.flags);
		let match: RegExpExecArray | null = re.exec(content);
		while (match !== null) {
			const raw = match[1] ?? "";
			const trimmed = raw.trim().replace(/\s+/g, " ");
			if (trimmed.length > 0) results.push(trimmed);
			match = re.exec(content);
		}
	}
	return results;
}

/** Tokenise a prohibition into content-bearing keywords. */
function keywordsOf(prohibition: string): string[] {
	return normalise(prohibition)
		.split(/[^a-z0-9-]+/)
		.filter((tok) => tok.length >= 3 && !STOPWORDS.has(tok));
}

function findFirstMatch(
	preferences: Tier1Preference[],
	toolText: string,
): { pref: Tier1Preference; prohibition: string } | null {
	if (!toolText) return null;
	const lowerToolText = normalise(toolText);
	for (const pref of preferences) {
		const prohibitions = extractProhibitions(pref.content);
		for (const prohibition of prohibitions) {
			const keywords = keywordsOf(prohibition);
			// Require ≥2 distinct content keywords so trivial one-word matches
			// (e.g. "commit") don't misfire on unrelated commands.
			if (keywords.length < 2) continue;
			if (keywords.every((kw) => lowerToolText.includes(kw))) {
				return { pref, prohibition };
			}
		}
	}
	return null;
}

/**
 * Main entry point. Returns a deny response on a confident match, or null to
 * let the tool call proceed. Never throws.
 */
export async function runPreferenceGuard(
	db: SiaDb,
	event: HookEvent,
): Promise<PreferenceGuardDenyResponse | null> {
	try {
		const toolName = event.tool_name;
		if (!toolName || !ENFORCED_TOOLS.has(toolName)) return null;

		const toolText = extractToolText(event);
		if (!toolText.trim()) return null;

		const preferences = await getActiveTier1Preferences(db);
		if (preferences.length === 0) return null;

		const hit = findFirstMatch(preferences, toolText);
		if (!hit) return null;

		const reason =
			hit.pref.content.trim() ||
			hit.pref.summary.trim() ||
			hit.pref.name.trim() ||
			"Tier-1 Preference violation";

		process.stderr.write(
			`sia preference-guard denied ${toolName}: matched "${hit.prohibition}" against preference ${hit.pref.id}\n`,
		);

		return {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		};
	} catch (err) {
		process.stderr.write(`sia preference-guard error: ${String(err)}\n`);
		return null;
	}
}
