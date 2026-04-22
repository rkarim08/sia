// Module: user-prompt-submit — UserPromptSubmit hook handler
//
// On every user prompt this handler does three things:
//
// 1. Classifies the prompt into a coarse `task_type` (bug-fix | feature |
//    review | trivial) using the same keyword lists CLAUDE.md Step 0
//    defines. The result is stashed on the UserPrompt node's `tags` as
//    `task:<type>` so it is observable without a schema migration.
// 2. Creates a UserPrompt node (always) plus a UserDecision node when the
//    prompt matches a correction / preference regex.
// 3. When the prompt is ≥20 chars, runs a top-k hybrid search against the
//    graph and looks up any open `Concern` nodes whose topic matches a
//    keyword in the prompt. The combined markdown is returned as
//    `additionalContext` for Claude Code to inject into the conversation.
//
// Cost discipline:
//   - Prompts shorter than `RETRIEVAL_MIN_CHARS` skip retrieval entirely.
//   - Retrieval results are memoised per `(session_id, prompt-hash)` via
//     `src/hooks/memoize.ts` so repeat hook fires in the same turn don't
//     re-query.
//   - A 200 ms hard timeout wraps the combined retrieval + concern lookup.
//     On timeout we log to stderr and return no additionalContext.

import { createHash } from "node:crypto";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { memoizeForTurn } from "@/hooks/memoize";
import { hybridSearch } from "@/retrieval/search";
import type { SiaConfig } from "@/shared/config";

export interface UserPromptEvent {
	session_id: string;
	prompt: string;
}

export type TaskType = "bug-fix" | "feature" | "review" | "trivial";

export interface UserPromptSubmitResult {
	nodesCreated: number;
	/** Optional markdown context for Claude Code to inject. Undefined when
	 * retrieval was skipped, timed out, or produced no hits. */
	additionalContext?: string;
	/** Classified task type for observability. */
	taskType: TaskType;
	/**
	 * Promise that resolves once any background retrieval work spawned by
	 * `withTimeout` has settled. When the 200 ms timer fires first, the
	 * underlying graph queries keep running; callers that own the database
	 * connection MUST `await` this before closing the DB so in-flight
	 * queries do not throw "database closed" warnings or leak resources.
	 *
	 * Always resolves (never rejects) — errors from background work are
	 * silently suppressed because the primary handler result has already
	 * been returned by the time this settles.
	 */
	pendingBackgroundWork: Promise<void>;
}

const CORRECTION_PATTERNS = [
	/use\s+\S+\s+instead\s+of/i,
	/don't use/i,
	/do not use/i,
	/switch to/i,
	/prefer\s+\S+/i,
	/always\s+\S+/i,
	/never\s+\S+/i,
];

// Keyword lists mirror CLAUDE.md Step 0. Multi-word phrases are matched
// verbatim; single words use word-boundary regex to avoid false positives
// (e.g. "addition" should not trigger on "add").
const BUG_FIX_KEYWORDS: ReadonlyArray<string> = [
	"fix",
	"broken",
	"error",
	"failing",
	"crash",
	"regression",
	"slow",
	"exception",
	"500",
	"timeout",
	"wrong output",
	"not working",
];

const FEATURE_KEYWORDS: ReadonlyArray<string> = [
	"add",
	"implement",
	"build",
	"create",
	"new",
	"extend",
	"support",
	"integrate",
	"enable",
];

const REVIEW_KEYWORDS: ReadonlyArray<string> = [
	"review",
	"check",
	"audit",
	"convention",
	"style",
	"standards",
	"pr",
	"pull request",
	"lint",
	"code quality",
];

/** Prompts shorter than this skip retrieval altogether. */
const RETRIEVAL_MIN_CHARS = 20;

/** Hard ceiling for retrieval + concern lookup. */
const RETRIEVAL_TIMEOUT_MS = 200;

/** Top-k graph hits injected into additionalContext. */
const RETRIEVAL_LIMIT = 3;

/** Maximum open-concern nodes surfaced per prompt. */
const CONCERN_LIMIT = 3;

/**
 * Bookkeeping kinds that should never appear in retrieval context — they
 * represent per-session traffic, not durable knowledge. Notably excludes the
 * node we just inserted (`UserPrompt`) so BM25 does not echo the prompt back.
 * Matches the exclusion set used by `nous_curiosity` / `nous_state`.
 */
const BOOKKEEPING_KINDS: ReadonlySet<string> = new Set([
	"UserPrompt",
	"UserDecision",
	"SessionFlag",
	"Concern",
]);

/**
 * Classify a prompt into a coarse task type using CLAUDE.md Step 0
 * keyword lists. Precedence: bug-fix > review > feature > trivial so that
 * a prompt like "fix the lint review" lands on bug-fix, and
 * "add lint checks" lands on feature (add beats lint in feature-vs-review
 * tie because bug-fix is the highest priority bucket).
 */
export function classifyTaskType(text: string): TaskType {
	const lower = text.toLowerCase();
	if (matchesAny(lower, BUG_FIX_KEYWORDS)) return "bug-fix";
	if (matchesAny(lower, REVIEW_KEYWORDS)) return "review";
	if (matchesAny(lower, FEATURE_KEYWORDS)) return "feature";
	return "trivial";
}

function matchesAny(lower: string, keywords: ReadonlyArray<string>): boolean {
	for (const kw of keywords) {
		if (kw.includes(" ") || /\d/.test(kw)) {
			// Phrases and numeric tokens — substring match.
			if (lower.includes(kw)) return true;
		} else {
			// Single word — require word boundary to avoid "add" -> "addition".
			const re = new RegExp(`\\b${escapeRegExp(kw)}\\b`);
			if (re.test(lower)) return true;
		}
	}
	return false;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function handleUserPromptSubmit(
	db: SiaDb,
	event: UserPromptEvent,
	_config: SiaConfig,
): Promise<UserPromptSubmitResult> {
	if (!event.prompt?.trim()) {
		return {
			nodesCreated: 0,
			taskType: "trivial",
			pendingBackgroundWork: Promise.resolve(),
		};
	}

	const taskType = classifyTaskType(event.prompt);
	const tags = ["user-prompt", `task:${taskType}`];

	let nodesCreated = 0;

	// Always create a UserPrompt node
	await insertEntity(db, {
		type: "Concept",
		name: event.prompt.slice(0, 50),
		content: event.prompt,
		summary: event.prompt.slice(0, 80),
		tags: JSON.stringify(tags),
		kind: "UserPrompt",
		session_id: event.session_id,
	});
	nodesCreated++;

	// Check for correction/preference patterns → UserDecision
	for (const pattern of CORRECTION_PATTERNS) {
		if (pattern.test(event.prompt)) {
			await insertEntity(db, {
				type: "Decision",
				name: event.prompt.slice(0, 50),
				content: event.prompt,
				summary: event.prompt.slice(0, 80),
				tags: JSON.stringify(["user-preference"]),
				trust_tier: 1,
				kind: "UserDecision",
				session_id: event.session_id,
			});
			nodesCreated++;
			break; // Only one UserDecision per prompt
		}
	}

	// Retrieval + concern injection (cost-gated).
	const { additionalContext, pendingBackgroundWork } = await buildAdditionalContext(
		db,
		event,
		taskType,
	);
	return {
		nodesCreated,
		additionalContext,
		taskType,
		pendingBackgroundWork,
	};
}

/**
 * Build the combined "Relevant graph entities" + "Open concerns" markdown
 * block. Returns `{ additionalContext, pendingBackgroundWork }`.
 *
 * `additionalContext` is `undefined` when retrieval was skipped, timed out,
 * or produced no hits. Failures are logged to stderr — they MUST NOT break
 * the hook because UserPrompt node creation has already succeeded.
 *
 * `pendingBackgroundWork` resolves once the underlying retrieval promise
 * settles. On timeout the caller can use it to defer `db.close()` until the
 * orphaned query drains, preventing "database closed" warnings.
 */
async function buildAdditionalContext(
	db: SiaDb,
	event: UserPromptEvent,
	taskType: TaskType,
): Promise<{ additionalContext: string | undefined; pendingBackgroundWork: Promise<void> }> {
	if (event.prompt.length < RETRIEVAL_MIN_CHARS) {
		return { additionalContext: undefined, pendingBackgroundWork: Promise.resolve() };
	}

	const key = hashPrompt(event.prompt);

	// The memoized compute promise is tracked separately so the caller can
	// await it even when `withTimeout` rejects first. This is how we avoid
	// leaking in-flight DB queries once the plugin wrapper closes the db.
	const computePromise = memoizeForTurn<string | undefined>(event.session_id, key, async () => {
		const [searchBlock, concernBlock] = await Promise.all([
			runSearchBlock(db, event.prompt, taskType),
			runConcernBlock(db, event.prompt),
		]);

		const parts: string[] = [];
		if (searchBlock) parts.push(searchBlock);
		if (concernBlock) parts.push(concernBlock);
		return parts.length > 0 ? parts.join("\n\n") : undefined;
	});

	// A .then-catch handler that always resolves, so callers can await it
	// without having to re-handle the error. Any post-timeout DB errors
	// (e.g. "database closed") are silently absorbed here.
	const pendingBackgroundWork = computePromise.then(
		() => undefined,
		() => undefined,
	);

	try {
		const additionalContext = await withTimeout(computePromise, RETRIEVAL_TIMEOUT_MS);
		return { additionalContext, pendingBackgroundWork };
	} catch (err) {
		process.stderr.write(
			`[sia] user-prompt retrieval skipped (non-fatal): ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return { additionalContext: undefined, pendingBackgroundWork };
	}
}

async function runSearchBlock(
	db: SiaDb,
	prompt: string,
	taskType: TaskType,
): Promise<string | undefined> {
	const routerTaskType = taskType === "trivial" ? undefined : taskType;
	// Over-fetch so post-filtering bookkeeping kinds still leaves RETRIEVAL_LIMIT hits.
	const { results } = await hybridSearch(db, null, {
		query: prompt,
		taskType: routerTaskType,
		limit: RETRIEVAL_LIMIT * 3,
	});

	if (!results || results.length === 0) return undefined;

	// Look up `kind` for each result to drop bookkeeping nodes (UserPrompt, etc).
	const ids = results.map((r) => r.id);
	const placeholders = ids.map(() => "?").join(", ");
	const { rows: kindRows } = await db.execute(
		`SELECT id, kind FROM graph_nodes WHERE id IN (${placeholders})`,
		ids,
	);
	const kindMap = new Map<string, string | null>();
	for (const row of kindRows as Array<{ id: string; kind: string | null }>) {
		kindMap.set(row.id, row.kind);
	}

	const filtered = results.filter((r) => {
		const kind = kindMap.get(r.id);
		return !(kind && BOOKKEEPING_KINDS.has(kind));
	});

	if (filtered.length === 0) return undefined;

	const lines = ["## Relevant graph entities"];
	for (const r of filtered.slice(0, RETRIEVAL_LIMIT)) {
		const label = sanitizeMarkdown(r.name || r.id);
		const snippet = sanitizeMarkdown(
			(r.summary || r.content || "").replace(/\s+/g, " ").trim().slice(0, 140),
		);
		const tierMarker = r.trust_tier !== undefined ? ` (T${r.trust_tier})` : "";
		lines.push(`- **${label}**${tierMarker} — ${snippet}`);
	}
	return lines.join("\n");
}

async function runConcernBlock(db: SiaDb, prompt: string): Promise<string | undefined> {
	const keywords = extractKeywords(prompt);
	if (keywords.length === 0) return undefined;

	// Build a case-insensitive LIKE OR-chain over name + summary + tags.
	// We keep the query read-only — no status mutation, unlike nous_concern.
	const clauses: string[] = [];
	const params: unknown[] = [];
	for (const kw of keywords) {
		const pattern = `%${kw.toLowerCase()}%`;
		clauses.push("(LOWER(name) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(tags) LIKE ?)");
		params.push(pattern, pattern, pattern);
	}
	const whereTopic = clauses.length > 0 ? `AND (${clauses.join(" OR ")})` : "";

	const sql = `
		SELECT id, name, summary, confidence
		FROM graph_nodes
		WHERE kind = 'Concern'
			AND tags LIKE '%status:open%'
			AND t_valid_until IS NULL
			AND archived_at IS NULL
			${whereTopic}
		ORDER BY confidence DESC
		LIMIT ?
	`;

	const { rows } = await db.execute(sql, [...params, CONCERN_LIMIT]);
	if (!rows || rows.length === 0) return undefined;

	const lines = ["## Open concerns"];
	for (const row of rows as Array<Record<string, unknown>>) {
		const name = sanitizeMarkdown((row.name as string) ?? (row.id as string));
		const summary = sanitizeMarkdown(
			((row.summary as string | null) ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
		);
		lines.push(`- **${name}** — ${summary}`);
	}
	return lines.join("\n");
}

/**
 * Sanitize a string destined for embedding inside our markdown block so
 * the downstream compactor still sees well-formed markdown:
 *   - strip leading `#` characters (prevents spurious headings)
 *   - replace triple-backtick fences with single-backticks so they cannot
 *     prematurely close a surrounding code block
 */
function sanitizeMarkdown(s: string): string {
	return s.replace(/^#+\s*/, "").replace(/```/g, "`");
}

/** Extract useful keywords from the prompt for the Concern match query.
 *  We lower-case, split on non-word boundaries, drop common stop words, and
 *  dedupe while preserving insertion order. Keywords shorter than 4 chars
 *  are dropped to keep SQL LIKE selective. */
function extractKeywords(prompt: string): string[] {
	const STOP = new Set<string>([
		"the",
		"and",
		"for",
		"with",
		"this",
		"that",
		"from",
		"into",
		"about",
		"what",
		"when",
		"where",
		"which",
		"have",
		"has",
		"had",
		"but",
		"not",
		"are",
		"was",
		"were",
		"you",
		"your",
		"our",
		"their",
		"there",
		"then",
		"than",
		"will",
		"would",
		"could",
		"should",
		"please",
		"need",
		"want",
		"make",
		"look",
		"also",
	]);
	const seen = new Set<string>();
	const out: string[] = [];
	for (const tok of prompt.toLowerCase().split(/[^a-z0-9_\-]+/)) {
		if (tok.length < 4) continue;
		if (STOP.has(tok)) continue;
		if (seen.has(tok)) continue;
		seen.add(tok);
		out.push(tok);
		if (out.length >= 6) break;
	}
	return out;
}

function hashPrompt(prompt: string): string {
	return createHash("sha1").update(prompt).digest("hex");
}

/** Race `p` against a timeout. The timeout rejects with a labelled error so
 *  the caller can log deterministically. Uses `unref` to avoid keeping the
 *  event loop alive in hook processes that finish early.
 *
 *  NOTE: when the timeout fires first, `p` keeps running in the background.
 *  Callers that hold a resource `p` depends on (e.g. a DB handle) MUST track
 *  `p` separately and await it before releasing the resource. See
 *  `buildAdditionalContext` → `pendingBackgroundWork` for the pattern. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const handle = setTimeout(() => {
			reject(new Error(`retrieval timed out after ${ms}ms`));
		}, ms);
		if (typeof handle === "object" && handle && "unref" in handle) {
			(handle as NodeJS.Timeout).unref();
		}
		p.then(
			(v) => {
				clearTimeout(handle);
				resolve(v);
			},
			(e) => {
				clearTimeout(handle);
				reject(e);
			},
		);
	});
}
