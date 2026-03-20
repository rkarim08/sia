// Integration test: Hooks → Graph
//
// Verifies that hook handlers write the expected graph_nodes entries.

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGraphDb } from "@/graph/semantic-db";
import { createPostToolUseHandler } from "@/hooks/handlers/post-tool-use";
import { handleUserPromptSubmit } from "@/hooks/handlers/user-prompt-submit";
import type { HookEvent } from "@/hooks/types";
import { DEFAULT_CONFIG } from "@/shared/config";

function makeTmpDir(suffix: string): string {
	const dir = join(tmpdir(), `sia-integ-hooks-${suffix}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// Stable fake repo hash for tests (not derived from a real path)
const FAKE_REPO_HASH = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

describe("Hooks → Graph integration", () => {
	let tmpDir: string;

	afterEach(() => {
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("PostToolUse Write creates a FileNode in graph_nodes", async () => {
		tmpDir = makeTmpDir("write");
		const db = openGraphDb(FAKE_REPO_HASH, tmpDir);

		try {
			const handler = createPostToolUseHandler(db);

			const event: HookEvent = {
				session_id: "sess-hooks-write-1",
				transcript_path: "/tmp/transcript.json",
				cwd: tmpDir,
				hook_event_name: "PostToolUse",
				tool_name: "Write",
				tool_input: {
					file_path: "src/api/handler.ts",
					content:
						"export function handleRequest(req: Request): Response {\n  return new Response('ok');\n}",
				},
			};

			const response = await handler(event);

			expect(response.status).toBe("processed");
			expect(response.nodes_created).toBeGreaterThan(0);

			// Verify a FileNode was created for the written file
			const { rows } = await db.execute(
				"SELECT type, name, extraction_method FROM graph_nodes WHERE type = 'FileNode'",
			);
			expect(rows.length).toBeGreaterThan(0);

			const fileNode = rows[0] as { type: string; name: string; extraction_method: string };
			expect(fileNode.type).toBe("FileNode");
			expect(fileNode.name).toBe("handler.ts");
			expect(fileNode.extraction_method).toBe("hook:post-tool-use:write");
		} finally {
			await db.close();
		}
	});

	it("PostToolUse Write with TypeScript content extracts CodeEntity via Track A", async () => {
		tmpDir = makeTmpDir("tracka");
		const db = openGraphDb(FAKE_REPO_HASH, tmpDir);

		try {
			const handler = createPostToolUseHandler(db);

			const event: HookEvent = {
				session_id: "sess-hooks-tracka-1",
				transcript_path: "/tmp/transcript.json",
				cwd: tmpDir,
				hook_event_name: "PostToolUse",
				tool_name: "Write",
				tool_input: {
					file_path: "src/utils/parser.ts",
					content:
						"export function parseConfig(input: string): Config {\n  return JSON.parse(input);\n}\n\nexport class ConfigLoader {\n  load(path: string): Config {\n    return parseConfig(path);\n  }\n}",
				},
			};

			await handler(event);

			// Should have FileNode + at least 1 CodeEntity from Track A
			const { rows: allNodes } = await db.execute(
				"SELECT type, name FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
			);
			const types = (allNodes as Array<{ type: string }>).map((r) => r.type);
			expect(types).toContain("FileNode");
			// Track A should extract function/class entities from the TypeScript content
			expect(allNodes.length).toBeGreaterThanOrEqual(2);
		} finally {
			await db.close();
		}
	});

	it("PostToolUse Edit creates a CodeEntity with kind EditEvent", async () => {
		tmpDir = makeTmpDir("edit");
		const db = openGraphDb(FAKE_REPO_HASH, tmpDir);

		try {
			const handler = createPostToolUseHandler(db);

			const event: HookEvent = {
				session_id: "sess-hooks-edit-1",
				transcript_path: "/tmp/transcript.json",
				cwd: tmpDir,
				hook_event_name: "PostToolUse",
				tool_name: "Edit",
				tool_input: {
					file_path: "src/config.ts",
					old_string: "const MAX = 10;",
					new_string: "const MAX = 100;",
				},
			};

			const response = await handler(event);

			expect(response.status).toBe("processed");
			expect(response.nodes_created).toBe(1);

			const { rows } = await db.execute(
				"SELECT type, name, kind FROM graph_nodes WHERE kind = 'EditEvent'",
			);
			expect(rows.length).toBe(1);
			const editNode = rows[0] as { type: string; kind: string; name: string };
			expect(editNode.type).toBe("CodeEntity");
			expect(editNode.kind).toBe("EditEvent");
		} finally {
			await db.close();
		}
	});

	it("PostToolUse Bash creates a CodeEntity with kind ExecutionEvent", async () => {
		tmpDir = makeTmpDir("bash");
		const db = openGraphDb(FAKE_REPO_HASH, tmpDir);

		try {
			const handler = createPostToolUseHandler(db);

			const event: HookEvent = {
				session_id: "sess-hooks-bash-1",
				transcript_path: "/tmp/transcript.json",
				cwd: tmpDir,
				hook_event_name: "PostToolUse",
				tool_name: "Bash",
				tool_input: { command: "npm run build" },
				tool_response: "Build complete. 0 errors.",
			};

			const response = await handler(event);

			expect(response.status).toBe("processed");

			const { rows } = await db.execute(
				"SELECT type, name, kind FROM graph_nodes WHERE kind = 'ExecutionEvent'",
			);
			expect(rows.length).toBe(1);
			const bashNode = rows[0] as { type: string; kind: string };
			expect(bashNode.type).toBe("CodeEntity");
			expect(bashNode.kind).toBe("ExecutionEvent");
		} finally {
			await db.close();
		}
	});

	it("UserPromptSubmit creates a UserDecision node with trust_tier 1 for correction patterns", async () => {
		tmpDir = makeTmpDir("userprompt");
		const db = openGraphDb(FAKE_REPO_HASH, tmpDir);

		try {
			const result = await handleUserPromptSubmit(
				db,
				{
					session_id: "sess-hooks-prompt-1",
					prompt: "use TypeScript instead of JavaScript for all new files",
				},
				DEFAULT_CONFIG,
			);

			expect(result.nodesCreated).toBeGreaterThanOrEqual(2);

			// Should have a UserDecision with trust_tier = 1
			const { rows } = await db.execute(
				"SELECT type, trust_tier, kind FROM graph_nodes WHERE kind = 'UserDecision'",
			);
			expect(rows.length).toBe(1);

			const decision = rows[0] as { type: string; trust_tier: number; kind: string };
			expect(decision.type).toBe("Decision");
			expect(decision.trust_tier).toBe(1);
			expect(decision.kind).toBe("UserDecision");
		} finally {
			await db.close();
		}
	});

	it("UserPromptSubmit creates a UserPrompt node for every prompt", async () => {
		tmpDir = makeTmpDir("userprompt2");
		const db = openGraphDb(FAKE_REPO_HASH, tmpDir);

		try {
			await handleUserPromptSubmit(
				db,
				{
					session_id: "sess-hooks-prompt-2",
					prompt: "What is the current state of the auth module?",
				},
				DEFAULT_CONFIG,
			);

			// Non-correction prompt: only UserPrompt, no UserDecision
			const { rows: promptRows } = await db.execute(
				"SELECT kind FROM graph_nodes WHERE kind = 'UserPrompt'",
			);
			expect(promptRows.length).toBe(1);

			const { rows: decisionRows } = await db.execute(
				"SELECT kind FROM graph_nodes WHERE kind = 'UserDecision'",
			);
			expect(decisionRows.length).toBe(0);
		} finally {
			await db.close();
		}
	});

	it("PostToolUse Read handler skips without creating nodes", async () => {
		tmpDir = makeTmpDir("read");
		const db = openGraphDb(FAKE_REPO_HASH, tmpDir);

		try {
			const handler = createPostToolUseHandler(db);

			const event: HookEvent = {
				session_id: "sess-hooks-read-1",
				transcript_path: "/tmp/transcript.json",
				cwd: tmpDir,
				hook_event_name: "PostToolUse",
				tool_name: "Read",
				tool_input: { file_path: "src/config.ts" },
			};

			const response = await handler(event);

			expect(response.status).toBe("processed");
			expect(response.nodes_created).toBe(0);

			const { rows } = await db.execute("SELECT id FROM graph_nodes");
			expect(rows.length).toBe(0);
		} finally {
			await db.close();
		}
	});
});
