import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { getActiveEntities } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { createStopHandler } from "@/hooks/handlers/stop";
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
		hook_event_name: "Stop",
		...overrides,
	};
}

/** Write a JSONL transcript file and return its path. */
function writeTranscript(dir: string, lines: Record<string, unknown>[]): string {
	const path = join(dir, "transcript.jsonl");
	const content = lines.map((l) => JSON.stringify(l)).join("\n");
	writeFileSync(path, content, "utf-8");
	return path;
}

describe("createStopHandler", () => {
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

	it("returns no_new_knowledge when transcript has no knowledge patterns", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("stop-empty", tmpDir);
		const handler = createStopHandler(db);

		const transcriptPath = writeTranscript(tmpDir, [
			{ role: "user", content: "Hello, how are you?" },
			{ role: "assistant", content: "I am fine, thanks!" },
		]);

		const event = baseEvent({ transcript_path: transcriptPath });
		const result = await handler(event);
		expect(result.status).toBe("no_new_knowledge");
	});

	it("detects knowledge patterns in assistant messages", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("stop-patterns", tmpDir);
		const handler = createStopHandler(db);

		const transcriptPath = writeTranscript(tmpDir, [
			{ role: "user", content: "How should we handle auth?" },
			{
				role: "assistant",
				content: "We decided to use JWT tokens with refresh rotation.",
			},
		]);

		const event = baseEvent({ transcript_path: transcriptPath });
		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_created).toBeGreaterThanOrEqual(1);

		const entities = await getActiveEntities(db);
		expect(entities.some((e) => e.type === "Decision")).toBe(true);
	});

	it("detects sia_note tool calls in transcript", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("stop-sia-note", tmpDir);
		const handler = createStopHandler(db);

		const transcriptPath = writeTranscript(tmpDir, [
			{ role: "user", content: "Note this convention" },
			{
				role: "assistant",
				content: "I'll note that.",
				tool_calls: [
					{
						name: "sia_note",
						input: { content: "Convention: always validate inputs" },
					},
				],
			},
		]);

		const event = baseEvent({ transcript_path: transcriptPath });
		const result = await handler(event);
		// When sia_note was already called, the Stop handler reports already_captured
		expect(result.status).toBe("already_captured");
	});

	it("handles missing transcript file gracefully", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("stop-missing", tmpDir);
		const handler = createStopHandler(db);

		const event = baseEvent({
			transcript_path: join(tmpDir, "nonexistent.jsonl"),
		});

		const result = await handler(event);
		expect(result.status).toBe("no_new_knowledge");
	});

	it("extracts multiple patterns from assistant messages", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("stop-multi", tmpDir);
		const handler = createStopHandler(db);

		const transcriptPath = writeTranscript(tmpDir, [
			{
				role: "assistant",
				content:
					"We decided to use Bun for the runtime. Convention: always run lint before commit.",
			},
			{
				role: "assistant",
				content: "BUG: the migration script fails on empty databases.",
			},
		]);

		const event = baseEvent({ transcript_path: transcriptPath });
		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_created).toBeGreaterThanOrEqual(3);
	});

	it("only scans the recent segment of the transcript (last 50 lines)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("stop-recent", tmpDir);
		const handler = createStopHandler(db);

		// Generate 100 filler lines + 1 knowledge line at the end
		const lines: Record<string, unknown>[] = [];
		for (let i = 0; i < 100; i++) {
			lines.push({ role: "user", content: `filler message ${i}` });
		}
		lines.push({
			role: "assistant",
			content: "We decided to switch to PostgreSQL.",
		});

		const transcriptPath = writeTranscript(tmpDir, lines);
		const event = baseEvent({ transcript_path: transcriptPath });
		const result = await handler(event);
		// The decision is in the recent tail segment, so it should be found
		expect(result.status).toBe("processed");
	});
});
