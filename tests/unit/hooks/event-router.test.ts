import { afterEach, describe, expect, it } from "vitest";
import {
	clearHandlers,
	getHandler,
	getHookConfig,
	registerHandler,
	startHookServer,
} from "@/hooks/event-router";
import type { HookEvent, HookResponse } from "@/hooks/types";

describe("hook event router", () => {
	afterEach(() => {
		clearHandlers();
	});

	it("registers and retrieves handlers", () => {
		const handler = async () => ({ status: "processed" as const });
		registerHandler("post-tool-use", handler);
		expect(getHandler("post-tool-use")).toBe(handler);
	});

	it("returns undefined for unregistered handlers", () => {
		expect(getHandler("unknown")).toBeUndefined();
	});

	it("clearHandlers removes all handlers", () => {
		registerHandler("stop", async () => ({ status: "processed" }));
		clearHandlers();
		expect(getHandler("stop")).toBeUndefined();
	});

	it("getHookConfig returns correct structure", () => {
		const config = getHookConfig(4521);
		expect(config.PostToolUse).toHaveLength(1);
		expect((config.PostToolUse[0] as Record<string, unknown>).type).toBe("http");
		expect((config.PostToolUse[0] as Record<string, unknown>).async).toBe(true);
		expect(config.Stop).toHaveLength(1);
		expect((config.Stop[0] as Record<string, unknown>).async).toBeUndefined(); // sync
		expect(config.SessionStart).toHaveLength(1);
		expect((config.SessionStart[0] as Record<string, unknown>).type).toBe("command");
	});

	it("HTTP server dispatches to registered handler", async () => {
		const handler = async (_event: HookEvent): Promise<HookResponse> => ({
			status: "processed",
			nodes_created: 1,
		});
		registerHandler("post-tool-use", handler);

		const server = startHookServer(0); // random port
		try {
			const res = await fetch(`http://localhost:${server.port}/hooks/post-tool-use`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					session_id: "test-session",
					transcript_path: "/tmp/test",
					cwd: "/tmp",
					hook_event_name: "PostToolUse",
					tool_name: "Write",
				}),
			});
			const data = await res.json();
			expect(data.status).toBe("processed");
			expect(data.nodes_created).toBe(1);
		} finally {
			server.stop();
		}
	});

	it("returns 404 for unknown hook event", async () => {
		const server = startHookServer(0);
		try {
			const res = await fetch(`http://localhost:${server.port}/hooks/unknown`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					session_id: "s",
					transcript_path: "/t",
					cwd: "/c",
					hook_event_name: "x",
				}),
			});
			expect(res.status).toBe(404);
		} finally {
			server.stop();
		}
	});

	it("health endpoint returns handler list", async () => {
		registerHandler("stop", async () => ({ status: "processed" }));
		const server = startHookServer(0);
		try {
			const res = await fetch(`http://localhost:${server.port}/health`);
			const data = await res.json();
			expect(data.status).toBe("ok");
			expect(data.handlers).toContain("stop");
		} finally {
			server.stop();
		}
	});
});
