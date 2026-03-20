// src/hooks/event-router.ts — HTTP hook endpoint server
//
// Runs alongside the MCP stdio server. Receives hook events from Claude Code
// as HTTP POST requests and dispatches to the appropriate handler.
//
// PostToolUse hooks run async (non-blocking). Stop and PreCompact run sync.
// SessionStart uses a command hook (not HTTP) — handled separately.
//
// Uses node:http for cross-runtime compatibility (Bun + Node/Vitest).

import { createServer, type Server } from "node:http";
import type { HookEvent, HookHandler, HookResponse } from "./types";

const DEFAULT_PORT = 4521;

/** Registry of hook handlers by event name */
const handlers: Record<string, HookHandler> = {};

/**
 * Register a handler for a hook event name.
 * Event names: "post-tool-use", "stop", "pre-compact", "post-compact",
 *              "session-start", "session-end", "user-prompt-submit"
 */
export function registerHandler(eventName: string, handler: HookHandler): void {
	handlers[eventName] = handler;
}

/**
 * Get a registered handler. Returns undefined if not found.
 */
export function getHandler(eventName: string): HookHandler | undefined {
	return handlers[eventName];
}

/**
 * Clear all registered handlers (for testing).
 */
export function clearHandlers(): void {
	for (const key of Object.keys(handlers)) {
		delete handlers[key];
	}
}

/** Read the full request body as a string. */
function readBody(req: import("node:http").IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

/** Send a JSON response. */
function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(json),
	});
	res.end(json);
}

/**
 * Start the HTTP hook event server.
 * Returns a server object that can be stopped.
 */
export function startHookServer(port: number = DEFAULT_PORT): {
	port: number;
	stop: () => void;
} {
	const server: Server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://localhost:${port}`);

		// Health check
		if (url.pathname === "/health") {
			sendJson(res, 200, {
				status: "ok",
				handlers: Object.keys(handlers),
			});
			return;
		}

		// Hook dispatch: /hooks/<event-name>
		const match = url.pathname.match(/^\/hooks\/(.+)$/);
		if (!match) {
			res.writeHead(404);
			res.end("Not found");
			return;
		}

		const eventName = match[1];
		const handler = handlers[eventName];
		if (!handler) {
			sendJson(res, 404, {
				status: "error",
				error: `No handler for event: ${eventName}`,
			} satisfies HookResponse);
			return;
		}

		try {
			const body = await readBody(req);
			const event: HookEvent = JSON.parse(body);
			const response = await handler(event);
			sendJson(res, 200, response);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			sendJson(res, 500, {
				status: "error",
				error: message,
			} satisfies HookResponse);
		}
	});

	server.listen(port);

	// Resolve the actual port (important when port=0 for random assignment)
	const addr = server.address();
	const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;

	return {
		port: actualPort,
		stop: () => server.close(),
	};
}

/**
 * Get the hook configuration for .claude/settings.json.
 * Used by `npx sia install` to register hooks.
 */
export function getHookConfig(port: number = DEFAULT_PORT): Record<string, unknown[]> {
	return {
		PostToolUse: [
			{
				type: "http",
				url: `http://localhost:${port}/hooks/post-tool-use`,
				timeout: 5000,
				async: true,
			},
		],
		Stop: [
			{
				type: "http",
				url: `http://localhost:${port}/hooks/stop`,
				timeout: 10000,
			},
		],
		PreCompact: [
			{
				type: "http",
				url: `http://localhost:${port}/hooks/pre-compact`,
				timeout: 5000,
			},
		],
		PostCompact: [
			{
				type: "http",
				url: `http://localhost:${port}/hooks/post-compact`,
				timeout: 5000,
				async: true,
			},
		],
		SessionStart: [{ type: "command", command: "npx sia hook session-start" }],
		SessionEnd: [
			{
				type: "http",
				url: `http://localhost:${port}/hooks/session-end`,
				timeout: 5000,
				async: true,
			},
		],
		UserPromptSubmit: [
			{
				type: "http",
				url: `http://localhost:${port}/hooks/user-prompt-submit`,
				timeout: 5000,
				async: true,
			},
		],
	};
}
