import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeClaudeCodeEvent } from "@/hooks/adapters/claude-code";
import { normalizeClineEvent } from "@/hooks/adapters/cline";
import { normalizeCursorEvent } from "@/hooks/adapters/cursor";
import { detectAgent, getRecommendedCaptureMode } from "@/hooks/agent-detect";

let tempDir: string;

beforeEach(() => {
	tempDir = join(tmpdir(), `sia-agent-detect-test-${Date.now()}`);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

describe("detectAgent", () => {
	it("detects claude-code from .claude/ directory", () => {
		mkdirSync(join(tempDir, ".claude"));
		expect(detectAgent(tempDir)).toBe("claude-code");
	});

	it("detects cursor from .cursor/ directory", () => {
		mkdirSync(join(tempDir, ".cursor"));
		expect(detectAgent(tempDir)).toBe("cursor");
	});

	it("detects cline from .clinerules/ directory", () => {
		mkdirSync(join(tempDir, ".clinerules"));
		expect(detectAgent(tempDir)).toBe("cline");
	});

	it("returns generic for unknown agent", () => {
		expect(detectAgent(tempDir)).toBe("generic");
	});

	it("prioritizes claude-code over cursor when both directories exist", () => {
		mkdirSync(join(tempDir, ".claude"));
		mkdirSync(join(tempDir, ".cursor"));
		expect(detectAgent(tempDir)).toBe("claude-code");
	});
});

describe("getRecommendedCaptureMode", () => {
	it("returns hooks for claude-code", () => {
		expect(getRecommendedCaptureMode("claude-code")).toBe("hooks");
	});

	it("returns hooks for cursor", () => {
		expect(getRecommendedCaptureMode("cursor")).toBe("hooks");
	});

	it("returns hooks for cline", () => {
		expect(getRecommendedCaptureMode("cline")).toBe("hooks");
	});

	it("returns api for generic", () => {
		expect(getRecommendedCaptureMode("generic")).toBe("api");
	});
});

describe("normalizeClaudeCodeEvent", () => {
	it("passes through raw event as-is (identity mapping)", () => {
		const raw = {
			session_id: "abc123",
			transcript_path: "/tmp/transcript.jsonl",
			cwd: "/home/user/project",
			hook_event_name: "PostToolUse",
			tool_name: "Write",
		};
		const event = normalizeClaudeCodeEvent(raw);
		expect(event.session_id).toBe("abc123");
		expect(event.hook_event_name).toBe("PostToolUse");
		expect(event.tool_name).toBe("Write");
	});
});

describe("normalizeCursorEvent", () => {
	it("maps afterFileEdit to PostToolUse with Write tool", () => {
		const raw = {
			event: "afterFileEdit" as const,
			filePath: "/home/user/project/src/index.ts",
			content: "export const x = 1;",
		};
		const event = normalizeCursorEvent(raw);
		expect(event.hook_event_name).toBe("PostToolUse");
		expect(event.tool_name).toBe("Write");
		expect(event.tool_input).toMatchObject({ file_path: raw.filePath });
	});

	it("maps afterModelResponse to Stop", () => {
		const raw = {
			event: "afterModelResponse" as const,
			response: "I have completed the task.",
		};
		const event = normalizeCursorEvent(raw);
		expect(event.hook_event_name).toBe("Stop");
	});

	it("maps beforeSubmitPrompt to UserPromptSubmit", () => {
		const raw = {
			event: "beforeSubmitPrompt" as const,
		};
		const event = normalizeCursorEvent(raw);
		expect(event.hook_event_name).toBe("UserPromptSubmit");
	});
});

describe("normalizeClineEvent", () => {
	it("passes through PostToolUse events correctly", () => {
		const raw = {
			session_id: "cline-session-1",
			transcript_path: "/tmp/cline-transcript.jsonl",
			cwd: "/home/user/project",
			hook_event_name: "PostToolUse",
			tool_name: "write_to_file",
		};
		const event = normalizeClineEvent(raw);
		expect(event.hook_event_name).toBe("PostToolUse");
		expect(event.session_id).toBe("cline-session-1");
	});

	it("normalizes tool names to Claude Code conventions", () => {
		const raw = {
			session_id: "cline-session-2",
			transcript_path: "/tmp/cline-transcript.jsonl",
			cwd: "/home/user/project",
			hook_event_name: "PostToolUse",
			tool_name: "write_to_file",
		};
		const event = normalizeClineEvent(raw);
		expect(event.tool_name).toBe("Write");
	});

	it("preserves unknown tool names as-is", () => {
		const raw = {
			session_id: "cline-session-3",
			transcript_path: "/tmp/cline-transcript.jsonl",
			cwd: "/home/user/project",
			hook_event_name: "PostToolUse",
			tool_name: "custom_tool",
		};
		const event = normalizeClineEvent(raw);
		expect(event.tool_name).toBe("custom_tool");
	});
});
