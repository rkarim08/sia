import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { createPostToolUseHandler } from "@/hooks/handlers/post-tool-use";
import type { HookEvent } from "@/hooks/types";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("handleRead — proactive knowledge injection", () => {
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

	it("should query graph for file-related entities when a file is read", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("read-knowledge", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "Use JWT for auth",
			content: "We chose JWT tokens over session cookies",
			summary: "JWT auth decision",
			file_paths: JSON.stringify(["src/auth/login.ts"]),
		});

		const handler = createPostToolUseHandler(db);
		const event: HookEvent = {
			session_id: "test",
			transcript_path: "",
			cwd: process.cwd(),
			hook_event_name: "PostToolUse",
			tool_name: "Read",
			tool_input: { file_path: "src/auth/login.ts" },
		};

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect((result as any).context).toBeDefined();
		expect((result as any).context.length).toBeGreaterThan(0);
		expect((result as any).context[0].name).toBe("Use JWT for auth");
	});

	it("should return empty context for files with no knowledge", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("read-empty", tmpDir);

		const handler = createPostToolUseHandler(db);
		const event: HookEvent = {
			session_id: "test",
			transcript_path: "",
			cwd: process.cwd(),
			hook_event_name: "PostToolUse",
			tool_name: "Read",
			tool_input: { file_path: "src/unknown/file.ts" },
		};

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect((result as any).context).toEqual([]);
	});
});
