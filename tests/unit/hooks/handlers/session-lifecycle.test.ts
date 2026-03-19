import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { createPostCompactHandler } from "@/hooks/handlers/post-compact";
import { createPreCompactHandler } from "@/hooks/handlers/pre-compact";
import { createSessionEndHandler } from "@/hooks/handlers/session-end";
import { buildSessionContext, formatSessionContext } from "@/hooks/handlers/session-start";
import type { HookEvent } from "@/hooks/types";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function baseEvent(overrides: Partial<HookEvent> = {}): HookEvent {
	return {
		session_id: "test-session-lifecycle",
		transcript_path: "/tmp/transcript.jsonl",
		cwd: "/tmp/project",
		hook_event_name: "SessionStart",
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

// ---------------------------------------------------------------------------
// buildSessionContext + formatSessionContext
// ---------------------------------------------------------------------------

describe("buildSessionContext", () => {
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

	it("returns empty arrays when the graph has no entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("session-start-empty", tmpDir);

		const ctx = await buildSessionContext(db, "/tmp/project", false);

		expect(ctx.decisions).toBeInstanceOf(Array);
		expect(ctx.conventions).toBeInstanceOf(Array);
		expect(ctx.errors).toBeInstanceOf(Array);
		expect(ctx.resuming).toBe(false);
	});

	it("returns decisions array with Decision entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("session-start-decisions", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "Use JWT tokens",
			content: "We decided to use JWT tokens with refresh rotation.",
			summary: "Chose JWT over sessions for stateless auth.",
		});

		const ctx = await buildSessionContext(db, "/tmp/project", false);

		expect(ctx.decisions.length).toBeGreaterThanOrEqual(1);
		expect(ctx.decisions[0]).toHaveProperty("name");
		expect(ctx.decisions[0]).toHaveProperty("summary");
	});

	it("returns conventions array with Convention entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("session-start-conventions", tmpDir);

		await insertEntity(db, {
			type: "Convention",
			name: "Always lint before commit",
			content: "Convention: always run lint before commit.",
			summary: "Run biome lint before every git commit.",
		});

		const ctx = await buildSessionContext(db, "/tmp/project", false);

		expect(ctx.conventions.length).toBeGreaterThanOrEqual(1);
		expect(ctx.conventions[0]).toHaveProperty("name");
		expect(ctx.conventions[0]).toHaveProperty("summary");
	});

	it("returns errors array with Bug entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("session-start-bugs", tmpDir);

		await insertEntity(db, {
			type: "Bug",
			name: "Migration fails on empty DB",
			content: "BUG: the migration script fails on empty databases.",
			summary: "Migration script fails when database is empty.",
		});

		const ctx = await buildSessionContext(db, "/tmp/project", false);

		expect(ctx.errors.length).toBeGreaterThanOrEqual(1);
		expect(ctx.errors[0]).toHaveProperty("name");
		expect(ctx.errors[0]).toHaveProperty("summary");
	});

	it("sets resuming flag correctly", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("session-start-resume", tmpDir);

		const ctxResume = await buildSessionContext(db, "/tmp/project", true);
		expect(ctxResume.resuming).toBe(true);

		const ctxStart = await buildSessionContext(db, "/tmp/project", false);
		expect(ctxStart.resuming).toBe(false);
	});

	it("limits decisions to 5 and errors to 3", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("session-start-limits", tmpDir);

		// Insert 8 decisions
		for (let i = 0; i < 8; i++) {
			await insertEntity(db, {
				type: "Decision",
				name: `Decision ${i}`,
				content: `We decided to use option ${i}.`,
				summary: `Decision ${i} summary.`,
			});
		}

		// Insert 6 bugs
		for (let i = 0; i < 6; i++) {
			await insertEntity(db, {
				type: "Bug",
				name: `Bug ${i}`,
				content: `BUG: error in module ${i}.`,
				summary: `Bug ${i} summary.`,
			});
		}

		const ctx = await buildSessionContext(db, "/tmp/project", false);

		expect(ctx.decisions.length).toBeLessThanOrEqual(5);
		expect(ctx.errors.length).toBeLessThanOrEqual(3);
	});
});

describe("formatSessionContext", () => {
	it("returns a non-empty string for empty context", () => {
		const ctx = {
			decisions: [],
			conventions: [],
			errors: [],
			resuming: false,
		};
		const output = formatSessionContext(ctx);
		expect(typeof output).toBe("string");
		expect(output.length).toBeGreaterThan(0);
	});

	it("includes session knowledge header", () => {
		const ctx = {
			decisions: [],
			conventions: [],
			errors: [],
			resuming: false,
		};
		const output = formatSessionContext(ctx);
		expect(output).toMatch(/session|knowledge|context/i);
	});

	it("includes decision names when present", () => {
		const ctx = {
			decisions: [{ name: "Use JWT tokens", summary: "Chose JWT for auth." }],
			conventions: [],
			errors: [],
			resuming: false,
		};
		const output = formatSessionContext(ctx);
		expect(output).toContain("JWT");
	});

	it("includes convention names when present", () => {
		const ctx = {
			decisions: [],
			conventions: [{ name: "Always lint", summary: "Run biome before commit." }],
			errors: [],
			resuming: false,
		};
		const output = formatSessionContext(ctx);
		expect(output).toContain("lint");
	});

	it("includes error names when present", () => {
		const ctx = {
			decisions: [],
			conventions: [],
			errors: [{ name: "Migration bug", summary: "Fails on empty DB." }],
			resuming: false,
		};
		const output = formatSessionContext(ctx);
		expect(output).toContain("Migration");
	});

	it("mentions resuming when resuming=true", () => {
		const ctx = {
			decisions: [],
			conventions: [],
			errors: [],
			resuming: true,
		};
		const output = formatSessionContext(ctx);
		expect(output).toMatch(/resum/i);
	});
});

// ---------------------------------------------------------------------------
// createPreCompactHandler
// ---------------------------------------------------------------------------

describe("createPreCompactHandler", () => {
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

	it("returns processed status", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pre-compact-basic", tmpDir);
		const handler = createPreCompactHandler(db);

		const transcriptPath = writeTranscript(tmpDir, [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hello back" },
		]);

		const event = baseEvent({
			hook_event_name: "PreCompact",
			transcript_path: transcriptPath,
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
	});

	it("includes snapshot_nodes in response", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pre-compact-snapshot", tmpDir);
		const handler = createPreCompactHandler(db);

		const transcriptPath = writeTranscript(tmpDir, [
			{ role: "assistant", content: "We decided to use Bun for the runtime." },
		]);

		const event = baseEvent({
			hook_event_name: "PreCompact",
			transcript_path: transcriptPath,
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result).toHaveProperty("snapshot_nodes");
		expect(typeof result.snapshot_nodes).toBe("number");
	});

	it("handles missing transcript file gracefully", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pre-compact-missing", tmpDir);
		const handler = createPreCompactHandler(db);

		const event = baseEvent({
			hook_event_name: "PreCompact",
			transcript_path: join(tmpDir, "nonexistent.jsonl"),
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.snapshot_nodes).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// createPostCompactHandler
// ---------------------------------------------------------------------------

describe("createPostCompactHandler", () => {
	it("returns processed status", async () => {
		const handler = createPostCompactHandler();

		const event = baseEvent({
			hook_event_name: "PostCompact",
			compact_summary: "The session involved refactoring the auth module.",
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
	});

	it("includes compact_summary_length in response", async () => {
		const handler = createPostCompactHandler();
		const summary = "Summary of compacted content from the coding session.";

		const event = baseEvent({
			hook_event_name: "PostCompact",
			compact_summary: summary,
		});

		const result = await handler(event);
		expect(result).toHaveProperty("compact_summary_length");
		expect(result.compact_summary_length).toBe(summary.length);
	});

	it("handles missing compact_summary gracefully", async () => {
		const handler = createPostCompactHandler();

		const event = baseEvent({
			hook_event_name: "PostCompact",
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.compact_summary_length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// createSessionEndHandler
// ---------------------------------------------------------------------------

describe("createSessionEndHandler", () => {
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

	it("returns processed status", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("session-end-basic", tmpDir);
		const handler = createSessionEndHandler(db);

		const event = baseEvent({
			hook_event_name: "SessionEnd",
			session_id: "test-session-end-basic",
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
	});

	it("includes nodes_this_session in response", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("session-end-nodes", tmpDir);

		// Insert some entities that belong to this session
		const sessionId = "test-session-end-nodes";
		await insertEntity(db, {
			type: "Decision",
			name: "Use TypeScript",
			content: "We decided to use TypeScript.",
			summary: "TypeScript for type safety.",
			source_episode: sessionId,
		});

		const handler = createSessionEndHandler(db);
		const event = baseEvent({
			hook_event_name: "SessionEnd",
			session_id: sessionId,
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result).toHaveProperty("nodes_this_session");
		expect(typeof result.nodes_this_session).toBe("number");
		expect(result.nodes_this_session).toBeGreaterThanOrEqual(1);
	});

	it("returns zero nodes_this_session when session created no entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("session-end-zero", tmpDir);
		const handler = createSessionEndHandler(db);

		const event = baseEvent({
			hook_event_name: "SessionEnd",
			session_id: "session-with-no-entities",
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_this_session).toBe(0);
	});
});
