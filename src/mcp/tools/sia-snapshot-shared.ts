// Module: sia-snapshot-shared — Shared helpers for branch-keyed snapshot MCP handlers
//
// Currently exposes a single validator used by sia_snapshot_restore and
// sia_snapshot_prune to reject empty / whitespace-only branch names before
// they reach the graph layer. Keeping the validator here lets the three
// snapshot tool modules share the same error surface.

/**
 * Validate a branch name for the snapshot MCP handlers.
 *
 * The graph layer (see `src/graph/snapshots.ts`) does not enforce any
 * structural constraints on branch names, but at the MCP boundary we reject
 * obvious garbage (empty or whitespace-only strings) so callers get a clear
 * error instead of a silent miss. Throws `Error` on invalid input.
 *
 * Validation is trim-aware (so `"   "` is rejected), but the returned string
 * is the caller's original input — not the trimmed version. This preserves
 * the response `branch_name` field verbatim; the DB call naturally returns
 * `restored: false` for any padded name that does not match.
 */
export function validateBranchName(branchName: unknown): string {
	if (typeof branchName !== "string") {
		throw new Error("Invalid snapshot name: branch_name must be a string");
	}
	if (branchName.trim().length === 0) {
		throw new Error("Invalid snapshot name: branch_name must be a non-empty string");
	}
	return branchName;
}

/**
 * Validate a list of branch names for `sia_snapshot_prune`. Every entry must
 * satisfy `validateBranchName`; duplicates are preserved (the graph layer
 * handles them). Throws `Error` if any entry is invalid. Returns the
 * original entries unchanged (see `validateBranchName` for rationale).
 */
export function validateBranchNames(branchNames: unknown): string[] {
	if (!Array.isArray(branchNames)) {
		throw new Error("Invalid snapshot name: branch_names must be an array");
	}
	return branchNames.map((name) => validateBranchName(name));
}
