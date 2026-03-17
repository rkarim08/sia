/**
 * Pattern Injection Detector — two-pass check for instruction injection.
 *
 * Pass 1: regex scan for instruction-like, authority-claim, prompt-injection,
 *         and JSON-in-natural-text patterns.
 * Pass 2: imperative-verb density check.
 *
 * Pure synchronous string operations — no DB, no async.
 */

export interface PatternDetectionResult {
	flagged: boolean;
	reason?: string;
	score: number;
}

// ---------------------------------------------------------------------------
// Pass 1 — regex patterns.  Each match contributes 0.4 to the score.
// ---------------------------------------------------------------------------

interface PatternEntry {
	name: string;
	regex: RegExp;
}

const PATTERNS: PatternEntry[] = [
	{
		name: "instruction_like",
		regex: /\b(remember to always|from now on|this is mandatory|you must always|never forget)\b/i,
	},
	{
		name: "authority_claim",
		regex: /\b(team convention|project rule|always do|never do|mandatory practice|required by)\b/i,
	},
	{
		name: "prompt_injection",
		regex: /\b(ignore previous|disregard|override instructions|system prompt|you are now)\b/i,
	},
	{
		name: "json_in_text",
		regex: /\{["\s]*[a-z_]+["\s]*:/i,
	},
];

const SCORE_PER_PATTERN = 0.4;

// ---------------------------------------------------------------------------
// Pass 2 — imperative-verb density
// ---------------------------------------------------------------------------

const IMPERATIVE_WORDS: RegExp[] = [
	/\balways\b/i,
	/\bnever\b/i,
	/\bmust\b/i,
	/\bshall\b/i,
	/\bshould\b/i,
	/\bensure\b/i,
	/\bmake sure\b/i,
	/\bdo not\b/i,
	/\bdon't\b/i,
	/\brequire\b/i,
];

const DENSITY_THRESHOLD = 0.15;
const DENSITY_SCORE = 0.3;

// ---------------------------------------------------------------------------
// Flag threshold
// ---------------------------------------------------------------------------

const FLAG_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectInjection(content: string): PatternDetectionResult {
	if (!content || content.trim().length === 0) {
		return { flagged: false, score: 0 };
	}

	let score = 0;
	let firstReason: string | undefined;

	// Pass 1 — regex patterns
	for (const entry of PATTERNS) {
		if (entry.regex.test(content)) {
			score += SCORE_PER_PATTERN;
			if (!firstReason) {
				firstReason = entry.name;
			}
		}
	}

	// Pass 2 — imperative-verb density
	const words = content.split(/\s+/).filter((w) => w.length > 0);
	const wordCount = words.length;

	if (wordCount > 0) {
		let imperativeCount = 0;
		for (const pattern of IMPERATIVE_WORDS) {
			const matches = content.match(new RegExp(pattern.source, "gi"));
			if (matches) {
				imperativeCount += matches.length;
			}
		}

		const density = imperativeCount / wordCount;
		if (density > DENSITY_THRESHOLD) {
			score += DENSITY_SCORE;
			if (!firstReason) {
				firstReason = "imperative_density";
			}
		}
	}

	// Cap score at 1.0
	score = Math.min(score, 1.0);

	const flagged = score > FLAG_THRESHOLD;

	return {
		flagged,
		reason: flagged ? firstReason : undefined,
		score,
	};
}
