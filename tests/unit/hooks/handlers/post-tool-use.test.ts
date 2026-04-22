import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { getActiveEntities } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { createPostToolUseHandler } from "@/hooks/handlers/post-tool-use";
import type { HookEvent } from "@/hooks/types";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function baseEvent(overrides: Partial<HookEvent> = {}): HookEvent {
	return {
		session_id: "test-session",
		transcript_path: "/tmp/transcript.jsonl",
		cwd: "/tmp/project",
		hook_event_name: "PostToolUse",
		...overrides,
	};
}

describe("createPostToolUseHandler", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("handles Write tool — creates FileNode entity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-write", tmpDir);
		const handler = createPostToolUseHandler(db);

		const event = baseEvent({
			tool_name: "Write",
			tool_input: {
				file_path: "/tmp/project/src/index.ts",
				content: "export function main() { return 42; }",
			},
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_created).toBeGreaterThanOrEqual(1);

		const entities = await getActiveEntities(db);
		expect(entities.some((e) => e.type === "FileNode")).toBe(true);
	});

	it("handles Write tool — extracts code entities via TrackA", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-write-tracka", tmpDir);
		const handler = createPostToolUseHandler(db);

		const event = baseEvent({
			tool_name: "Write",
			tool_input: {
				file_path: "/tmp/project/src/utils.ts",
				content: [
					"export function parseConfig(raw: string) { return JSON.parse(raw); }",
					"export const DEFAULT_PORT = 3000;",
				].join("\n"),
			},
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");

		const entities = await getActiveEntities(db);
		const codeEntities = entities.filter((e) => e.type === "CodeEntity");
		expect(codeEntities.length).toBeGreaterThanOrEqual(2);
	});

	it("handles Edit tool — creates EditEvent entity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-edit", tmpDir);
		const handler = createPostToolUseHandler(db);

		const event = baseEvent({
			tool_name: "Edit",
			tool_input: {
				file_path: "/tmp/project/src/config.ts",
				old_string: "const PORT = 3000;",
				new_string: "const PORT = 4000;",
			},
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_created).toBeGreaterThanOrEqual(1);

		const entities = await getActiveEntities(db);
		expect(entities.some((e) => e.name.includes("config.ts"))).toBe(true);
	});

	it("handles Bash tool — creates ExecutionEvent entity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-bash", tmpDir);
		const handler = createPostToolUseHandler(db);

		const event = baseEvent({
			tool_name: "Bash",
			tool_input: { command: "npm test" },
			tool_response: "All 42 tests passed",
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_created).toBeGreaterThanOrEqual(1);
	});

	it("handles Bash with git commit — detects commit patterns", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-bash-git", tmpDir);
		const handler = createPostToolUseHandler(db);

		const event = baseEvent({
			tool_name: "Bash",
			tool_input: { command: 'git commit -m "fix(auth): resolve token leak"' },
			tool_response: "[main abc1234] fix(auth): resolve token leak",
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_created).toBeGreaterThanOrEqual(1);
	});

	it("handles Bash with error output — creates Bug entity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-bash-err", tmpDir);
		const handler = createPostToolUseHandler(db);

		const event = baseEvent({
			tool_name: "Bash",
			tool_input: { command: "bun run build" },
			tool_response: "Error: Cannot find module '@/missing'",
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");

		const entities = await getActiveEntities(db);
		const bugEntities = entities.filter((e) => e.type === "Bug");
		expect(bugEntities.length).toBeGreaterThanOrEqual(1);
	});

	it("handles Read tool — returns processed without creating nodes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-read", tmpDir);
		const handler = createPostToolUseHandler(db);

		const event = baseEvent({
			tool_name: "Read",
			tool_input: { file_path: "/tmp/project/src/index.ts" },
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
	});

	it("skips unknown tools", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-skip", tmpDir);
		const handler = createPostToolUseHandler(db);

		const event = baseEvent({
			tool_name: "UnknownTool",
			tool_input: {},
		});

		const result = await handler(event);
		expect(result.status).toBe("skipped");
		expect(result.nodes_created).toBe(0);
	});

	it("handles missing tool_input gracefully", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-no-input", tmpDir);
		const handler = createPostToolUseHandler(db);

		const event = baseEvent({ tool_name: "Write" });

		const result = await handler(event);
		expect(result.status).toBe("skipped");
	});

	// ---------------------------------------------------------------
	// Size / binary guards (Phase D1 #17) — skip TrackA for oversize or
	// binary content but still record the FileNode for the write.
	// ---------------------------------------------------------------

	it("skips TrackA for oversize (>500 KB) Write content — only FileNode is created", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-write-oversize", tmpDir);
		const handler = createPostToolUseHandler(db);

		// 600 KB of valid TS — small enough that TrackA *would* extract
		// multiple entities, but above the guard threshold.
		const fn = "export function foo() { return 1; }\n";
		const content = fn.repeat(Math.ceil(600_000 / fn.length));
		expect(content.length).toBeGreaterThan(500_000);

		const event = baseEvent({
			tool_name: "Write",
			tool_input: { file_path: "/tmp/project/huge.ts", content },
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_created).toBe(1); // FileNode only; TrackA + patterns skipped

		const entities = await getActiveEntities(db);
		expect(entities.filter((e) => e.type === "FileNode").length).toBe(1);
		// Zero TrackA-derived CodeEntity rows (the FileNode is a FileNode, not CodeEntity).
		expect(entities.filter((e) => e.type === "CodeEntity").length).toBe(0);
	});

	it("skips TrackA for binary-looking Write content (NUL byte heuristic)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-write-binary", tmpDir);
		const handler = createPostToolUseHandler(db);

		// Content with a NUL byte in the first 1 KB — our heuristic for binary.
		const content = `some prefix\x00then more\nexport function x() {}`;
		const event = baseEvent({
			tool_name: "Write",
			tool_input: { file_path: "/tmp/project/artifact.bin", content },
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_created).toBe(1); // FileNode only

		const entities = await getActiveEntities(db);
		expect(entities.filter((e) => e.type === "CodeEntity").length).toBe(0);
	});

	it("skips TrackA for oversize Edit new_string — only EditEvent is created", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-edit-oversize", tmpDir);
		const handler = createPostToolUseHandler(db);

		const fn = "export const k = 1;\n";
		const newStr = fn.repeat(Math.ceil(600_000 / fn.length));
		expect(newStr.length).toBeGreaterThan(500_000);

		const event = baseEvent({
			tool_name: "Edit",
			tool_input: {
				file_path: "/tmp/project/big.ts",
				old_string: "placeholder",
				new_string: newStr,
			},
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		// Exactly one EditEvent node — TrackA + patterns skipped.
		expect(result.nodes_created).toBe(1);
	});

	it("skips TrackA for binary-looking Edit new_string", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ptu-edit-binary", tmpDir);
		const handler = createPostToolUseHandler(db);

		const event = baseEvent({
			tool_name: "Edit",
			tool_input: {
				file_path: "/tmp/project/artifact.bin",
				old_string: "old",
				new_string: `hdr\x00payload\nexport function y() {}`,
			},
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_created).toBe(1); // EditEvent only
	});
});
