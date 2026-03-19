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
});
