// Module: commit-capture-dispatch — PostToolUse(Bash) subscriber
//
// Emits a `systemMessage` nudge that recommends dispatching the
// `@sia-knowledge-capture` agent when the agent just ran a successful
// `git commit` (non-amend) via the Bash tool. Hooks cannot dispatch
// agents directly — this writes a hint for the human/agent to action.
//
// Gate conditions (ALL must hold):
//   1. tool_name === "Bash"
//   2. tool_input.command matches /\bgit\s+commit\b/
//   3. the command is NOT a `--amend` (amends rewrite the same commit)
//   4. exit code (when present) is 0
//
// Any failure of the above returns `{ status: "skipped" }` without a
// systemMessage — knowledge capture should not be nagged on status/log
// calls, failed commits, or commit amends.

import type { HookEvent, HookHandler, HookResponse } from "@/hooks/types";

/** Pattern that detects `git commit` invocations (not status/log/diff). */
const GIT_COMMIT_RE = /\bgit\s+commit\b/;

/**
 * Pattern that detects `--amend` in a commit command. `--amend` rewrites
 * the existing commit in place, so re-dispatching knowledge capture would
 * double-capture the same change.
 */
const AMEND_RE = /\s--amend(?:=|\s|$)/;

/**
 * systemMessage emitted on a successful non-amend `git commit`. Deliberately
 * short — it's a prompt, not a full instruction. The recipient (human or
 * agent) is expected to know what `@sia-knowledge-capture` does.
 */
export const COMMIT_CAPTURE_HINT =
	"Git commit detected. Consider dispatching @sia-knowledge-capture to capture decisions/bugs from this change.";

/**
 * Result of a gate evaluation. Separated from the handler so tests can
 * exercise the classifier without constructing a full HookEvent.
 */
export interface CommitDetection {
	isCommit: boolean;
	isAmend: boolean;
	exitOk: boolean;
	/** True iff we should emit the hint. Equivalent to isCommit && !isAmend && exitOk. */
	shouldDispatch: boolean;
}

/**
 * Inspect a Bash command + exit code and decide whether a commit-capture
 * hint is warranted. Pure function; safe to unit test directly.
 */
export function detectGitCommit(command: string, exitCode: number): CommitDetection {
	const isCommit = GIT_COMMIT_RE.test(command);
	const isAmend = AMEND_RE.test(command);
	const exitOk = exitCode === 0;
	return {
		isCommit,
		isAmend,
		exitOk,
		shouldDispatch: isCommit && !isAmend && exitOk,
	};
}

/** Safely read `tool_input.command` as a string. */
function readCommand(event: HookEvent): string {
	const cmd = event.tool_input?.command;
	return typeof cmd === "string" ? cmd : "";
}

/** Safely read `tool_input.exit_code` as a number, defaulting to 0. */
function readExitCode(event: HookEvent): number {
	const raw = event.tool_input?.exit_code;
	if (typeof raw === "number") return raw;
	if (typeof raw === "string") {
		const parsed = Number.parseInt(raw, 10);
		return Number.isNaN(parsed) ? 0 : parsed;
	}
	return 0;
}

/**
 * Create a PostToolUse(Bash) handler that emits a systemMessage on
 * successful non-amend `git commit` commands. The handler is a no-op
 * for non-Bash tools and for commands that don't match the commit gate.
 */
export function createCommitCaptureDispatchHandler(): HookHandler {
	return async (event: HookEvent): Promise<HookResponse> => {
		if (event.tool_name !== "Bash") {
			return { status: "skipped" };
		}

		const command = readCommand(event);
		if (!command) {
			return { status: "skipped" };
		}

		const exitCode = readExitCode(event);
		const detection = detectGitCommit(command, exitCode);

		if (!detection.shouldDispatch) {
			return { status: "skipped" };
		}

		return {
			status: "processed",
			systemMessage: COMMIT_CAPTURE_HINT,
		};
	};
}
