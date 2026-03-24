import { describe, expect, it } from "vitest";
import { parsePluginHookEvent } from "@/hooks/plugin-common";

describe("parsePluginHookEvent", () => {
	it("should parse a PostToolUse event from Claude Code", () => {
		const input = JSON.stringify({
			session_id: "test-session",
			cwd: "/tmp/test-project",
			hook_event_name: "PostToolUse",
			tool_name: "Write",
			tool_input: { file_path: "/tmp/test.ts", content: "const x = 1;" },
		});
		const event = parsePluginHookEvent(input);
		expect(event.session_id).toBe("test-session");
		expect(event.tool_name).toBe("Write");
		expect(event.hook_event_name).toBe("PostToolUse");
		expect(event.cwd).toBe("/tmp/test-project");
	});

	it("should parse a Stop event", () => {
		const input = JSON.stringify({
			session_id: "test-session",
			cwd: "/tmp/test-project",
			hook_event_name: "Stop",
			transcript_path: "/tmp/transcript.jsonl",
		});
		const event = parsePluginHookEvent(input);
		expect(event.hook_event_name).toBe("Stop");
		expect(event.transcript_path).toBe("/tmp/transcript.jsonl");
	});

	it("should parse a SessionStart event", () => {
		const input = JSON.stringify({
			session_id: "test-session",
			cwd: "/tmp/test-project",
			hook_event_name: "SessionStart",
			source: "startup",
		});
		const event = parsePluginHookEvent(input);
		expect(event.hook_event_name).toBe("SessionStart");
		expect(event.source).toBe("startup");
	});

	it("should default missing optional fields", () => {
		const input = JSON.stringify({
			session_id: "test-session",
		});
		const event = parsePluginHookEvent(input);
		expect(event.session_id).toBe("test-session");
		expect(event.transcript_path).toBe("");
		expect(event.hook_event_name).toBe("unknown");
	});

	it("should throw on invalid JSON", () => {
		expect(() => parsePluginHookEvent("not json")).toThrow("Invalid JSON");
	});

	it("should throw on missing session_id", () => {
		const input = JSON.stringify({ cwd: "/tmp" });
		expect(() => parsePluginHookEvent(input)).toThrow("session_id");
	});

	it("should throw on non-string session_id", () => {
		const input = JSON.stringify({ session_id: 123 });
		expect(() => parsePluginHookEvent(input)).toThrow("session_id");
	});

	it("should preserve tool_input and tool_response", () => {
		const input = JSON.stringify({
			session_id: "s1",
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			tool_input: { command: "ls -la" },
			tool_response: "file1.ts\nfile2.ts",
			tool_use_id: "tu-123",
		});
		const event = parsePluginHookEvent(input);
		expect(event.tool_input).toEqual({ command: "ls -la" });
		expect(event.tool_response).toBe("file1.ts\nfile2.ts");
		expect(event.tool_use_id).toBe("tu-123");
	});
});
