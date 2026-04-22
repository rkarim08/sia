// tests/unit/hooks/handlers/commit-capture-dispatch.test.ts
//
// Covers the PostToolUse(Bash) commit-capture-dispatch subscriber:
//   - git commit detected → systemMessage present
//   - git status (not commit) → no systemMessage
//   - git commit --amend → no systemMessage
//   - non-zero exit code → no systemMessage
//   - non-Bash tool → no systemMessage
//   - missing tool_input → no systemMessage
//
// The handler has no side-effects (no db, no fs) — all tests are pure.

import { describe, expect, it } from "vitest";
import {
	COMMIT_CAPTURE_HINT,
	createCommitCaptureDispatchHandler,
	detectGitCommit,
} from "@/hooks/handlers/commit-capture-dispatch";
import type { HookEvent } from "@/hooks/types";

function baseEvent(overrides: Partial<HookEvent> = {}): HookEvent {
	return {
		session_id: "test-session",
		transcript_path: "/tmp/transcript.jsonl",
		cwd: "/tmp/project",
		hook_event_name: "PostToolUse",
		tool_name: "Bash",
		...overrides,
	};
}

describe("detectGitCommit", () => {
	it("detects a plain `git commit -m` invocation as a commit", () => {
		const d = detectGitCommit('git commit -m "feat: add thing"', 0);
		expect(d.isCommit).toBe(true);
		expect(d.isAmend).toBe(false);
		expect(d.shouldDispatch).toBe(true);
	});

	it("does not treat `git status` as a commit", () => {
		const d = detectGitCommit("git status", 0);
		expect(d.isCommit).toBe(false);
		expect(d.shouldDispatch).toBe(false);
	});

	it("does not treat `git log` as a commit", () => {
		const d = detectGitCommit("git log --oneline -n 5", 0);
		expect(d.isCommit).toBe(false);
		expect(d.shouldDispatch).toBe(false);
	});

	it("flags `git commit --amend` as amend and suppresses dispatch", () => {
		const d = detectGitCommit("git commit --amend --no-edit", 0);
		expect(d.isCommit).toBe(true);
		expect(d.isAmend).toBe(true);
		expect(d.shouldDispatch).toBe(false);
	});

	it("flags `git commit --amend -m` as amend", () => {
		const d = detectGitCommit('git commit --amend -m "reword"', 0);
		expect(d.isAmend).toBe(true);
		expect(d.shouldDispatch).toBe(false);
	});

	it("suppresses dispatch on non-zero exit code", () => {
		const d = detectGitCommit('git commit -m "broken"', 1);
		expect(d.isCommit).toBe(true);
		expect(d.exitOk).toBe(false);
		expect(d.shouldDispatch).toBe(false);
	});

	it("handles leading whitespace / chained commands", () => {
		const d = detectGitCommit('cd repo && git commit -m "x"', 0);
		expect(d.isCommit).toBe(true);
		expect(d.shouldDispatch).toBe(true);
	});
});

describe("createCommitCaptureDispatchHandler", () => {
	it("emits systemMessage for a successful git commit", async () => {
		const handler = createCommitCaptureDispatchHandler();
		const result = await handler(
			baseEvent({
				tool_input: { command: 'git commit -m "feat: new thing"', exit_code: 0 },
				tool_response: "[main abc1234] feat: new thing",
			}),
		);
		expect(result.status).toBe("processed");
		expect(result.systemMessage).toBe(COMMIT_CAPTURE_HINT);
	});

	it("does not emit systemMessage for `git status`", async () => {
		const handler = createCommitCaptureDispatchHandler();
		const result = await handler(
			baseEvent({
				tool_input: { command: "git status", exit_code: 0 },
			}),
		);
		expect(result.status).toBe("skipped");
		expect(result.systemMessage).toBeUndefined();
	});

	it("does not emit systemMessage for `git commit --amend`", async () => {
		const handler = createCommitCaptureDispatchHandler();
		const result = await handler(
			baseEvent({
				tool_input: {
					command: 'git commit --amend -m "reword"',
					exit_code: 0,
				},
			}),
		);
		expect(result.status).toBe("skipped");
		expect(result.systemMessage).toBeUndefined();
	});

	it("does not emit systemMessage when exit code is non-zero", async () => {
		const handler = createCommitCaptureDispatchHandler();
		const result = await handler(
			baseEvent({
				tool_input: {
					command: 'git commit -m "will fail"',
					exit_code: 1,
				},
			}),
		);
		expect(result.status).toBe("skipped");
		expect(result.systemMessage).toBeUndefined();
	});

	it("skips non-Bash tools entirely", async () => {
		const handler = createCommitCaptureDispatchHandler();
		const result = await handler(
			baseEvent({
				tool_name: "Write",
				tool_input: { file_path: "/tmp/foo.ts", content: "x" },
			}),
		);
		expect(result.status).toBe("skipped");
		expect(result.systemMessage).toBeUndefined();
	});

	it("skips when tool_input is missing", async () => {
		const handler = createCommitCaptureDispatchHandler();
		const result = await handler(baseEvent({ tool_input: undefined }));
		expect(result.status).toBe("skipped");
		expect(result.systemMessage).toBeUndefined();
	});

	it("defaults to exit_code 0 when the field is absent", async () => {
		const handler = createCommitCaptureDispatchHandler();
		// Real Claude Code events may omit exit_code — we must still fire
		// the hint for successful commits rather than silently skipping.
		const result = await handler(
			baseEvent({
				tool_input: { command: 'git commit -m "feat: add"' },
			}),
		);
		expect(result.status).toBe("processed");
		expect(result.systemMessage).toBe(COMMIT_CAPTURE_HINT);
	});
});
