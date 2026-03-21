// Module: truncate — Bounds MCP tool response payloads to a character budget.
//
// MCP tool responses are injected into the Claude context window. Unbounded
// responses from large graph queries can consume thousands of tokens.
// This utility truncates responses to a configurable character limit.

const DEFAULT_MAX_CHARS = 8000;
const MIN_MAX_CHARS = 100;

/** Describes a truncatable collection found on the response object. */
interface TruncatableField {
	key: string;
	items: unknown[];
	/** True when the original property was a Record<string, T[]> that we flattened. */
	flattened: boolean;
	/** When flattened, records original group keys and their item counts. */
	originalGroups?: Record<string, number>;
}

/**
 * Find the largest truncatable collection on an object.
 *
 * First pass: direct array properties (e.g. `entities`, `communities`, `results`).
 * Picks the **largest** non-empty array by item count, so multi-array responses
 * like sia_expand (neighbors + edges) truncate the dominant collection.
 *
 * Second pass (if no arrays found): grouped collections — plain objects whose
 * values are all arrays and that have >= 2 groups (e.g. `backlinks:
 * Record<string, BacklinkEntry[]>`). The >= 2 group threshold avoids
 * false-positives on objects that happen to have a single array-valued property.
 * These are flattened into a single array so the binary search can trim them
 * uniformly, with `_original_groups` metadata for consumer reconstruction.
 */
function findTruncatableField(obj: Record<string, unknown>): TruncatableField | null {
	// First pass: find the largest direct array property
	let best: TruncatableField | null = null;
	for (const [key, val] of Object.entries(obj)) {
		if (Array.isArray(val) && val.length > 0) {
			if (!best || val.length > best.items.length) {
				best = { key, items: val, flattened: false };
			}
		}
	}
	if (best) return best;

	// Second pass: Record<string, T[]> grouped collections (>= 2 groups to avoid false positives)
	for (const [key, val] of Object.entries(obj)) {
		if (val !== null && typeof val === "object" && !Array.isArray(val)) {
			const nested = val as Record<string, unknown>;
			const nestedEntries = Object.entries(nested);
			if (nestedEntries.length >= 2 && nestedEntries.every(([, v]) => Array.isArray(v))) {
				const originalGroups: Record<string, number> = {};
				const flatItems: unknown[] = [];
				for (const [groupKey, groupVal] of nestedEntries) {
					const arr = groupVal as unknown[];
					originalGroups[groupKey] = arr.length;
					flatItems.push(...arr);
				}
				if (flatItems.length > 0) {
					return { key, items: flatItems, flattened: true, originalGroups };
				}
			}
		}
	}

	return null;
}

/**
 * Binary-search for the max items from a bare array that fit within budget.
 * Wraps the result in an envelope with truncation metadata.
 */
function truncateArray(items: unknown[], serialized: string, maxChars: number): unknown {
	const originalCount = items.length;

	let lo = 0;
	let hi = items.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		const candidate = {
			items: items.slice(0, mid),
			_truncated: true,
			_original_count: originalCount,
			_showing: mid,
		};
		if (JSON.stringify(candidate).length <= maxChars) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}

	const showing = Math.max(lo, 1);
	const result = {
		items: items.slice(0, showing),
		_truncated: true,
		_original_count: originalCount,
		_showing: showing,
	};

	if (lo === 0 && JSON.stringify(result).length > maxChars) {
		return {
			_truncated: true,
			_original_count: originalCount,
			_original_size: serialized.length,
			_max_chars: maxChars,
			_message: `Response too large: array has ${originalCount} items but even 1 exceeds the ${maxChars}-char budget. Use more specific query parameters.`,
		};
	}

	return result;
}

/**
 * Truncate an MCP tool response to fit within a character budget.
 *
 * Strategy (in execution order):
 * 1. null/undefined — pass through unchanged.
 * 2. maxChars below MIN_MAX_CHARS (100) — pass through unchanged to avoid
 *    degenerate truncation.
 * 3. Serialization failure (e.g. circular references) — return a
 *    `_serialization_error` envelope.
 * 4. Serialized response fits within budget — return unchanged.
 * 5. String response — return a truncation envelope object (not a raw
 *    string, to avoid double-encoding when the caller JSON.stringify's).
 * 6. Bare array (e.g. sia_search returns T[]) — binary-search for max
 *    items that fit, wrapped in an `{items, _truncated}` envelope.
 * 7. Object with an array property (or grouped Record<string, T[]>) —
 *    binary-search for the max items that fit, add truncation metadata.
 *    If even 1 item exceeds the budget, an overflow envelope (with no
 *    items) is returned instead.
 * 8. Object with no truncatable collection — return a structured overflow envelope.
 */
export function truncateResponse(response: unknown, maxChars: number = DEFAULT_MAX_CHARS): unknown {
	if (response === null || response === undefined) return response;
	if (maxChars < MIN_MAX_CHARS) return response;

	let serialized: string;
	try {
		serialized = JSON.stringify(response);
	} catch (err) {
		return {
			_truncated: true,
			_serialization_error: true,
			_message: `Response could not be serialized: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	if (serialized.length <= maxChars) return response;

	// String: return structured envelope to avoid double-encoding
	// Reserve ~200 chars for the JSON envelope keys (_truncated, _original_size, text, quotes, braces)
	if (typeof response === "string") {
		return {
			_truncated: true,
			_original_size: response.length,
			text: response.slice(0, Math.max(maxChars - 200, MIN_MAX_CHARS)),
		};
	}

	// Bare array (e.g. sia_search returns SiaSearchResult[]): truncate directly
	if (Array.isArray(response)) {
		return truncateArray(response, serialized, maxChars);
	}

	// Object: find the dominant truncatable collection and binary-search for max items that fit
	if (typeof response === "object") {
		const obj = response as Record<string, unknown>;
		const field = findTruncatableField(obj);

		if (field) {
			const { key: arrayKey, items, flattened, originalGroups } = field;
			const originalCount = items.length;
			const flatMeta = flattened
				? { _flattened: true, ...(originalGroups ? { _original_groups: originalGroups } : {}) }
				: {};

			let lo = 0;
			let hi = items.length;
			while (lo < hi) {
				const mid = Math.ceil((lo + hi) / 2);
				const candidate = {
					...obj,
					[arrayKey]: items.slice(0, mid),
					_truncated: true,
					_original_count: originalCount,
					_showing: mid,
					...flatMeta,
				};
				if (JSON.stringify(candidate).length <= maxChars) {
					lo = mid;
				} else {
					hi = mid - 1;
				}
			}

			const showing = Math.max(lo, 1);
			const result = {
				...obj,
				[arrayKey]: items.slice(0, showing),
				_truncated: true,
				_original_count: originalCount,
				_showing: showing,
				...flatMeta,
			};

			// If even 1 item exceeds budget, return an overflow envelope
			if (lo === 0 && JSON.stringify(result).length > maxChars) {
				return {
					_truncated: true,
					_original_count: originalCount,
					_original_size: serialized.length,
					_max_chars: maxChars,
					_message: `Response too large: '${arrayKey}' has ${originalCount} items but even 1 exceeds the ${maxChars}-char budget. Use more specific query parameters.`,
				};
			}

			return result;
		}

		// No truncatable collection — overflow envelope
		return {
			_truncated: true,
			_original_size: serialized.length,
			_max_chars: maxChars,
			_message:
				"Response exceeded size limit. Use more specific query parameters to narrow results.",
		};
	}

	return response;
}
