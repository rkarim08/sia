import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { insertStagedFact } from "@/graph/staging";
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

	// -----------------------------------------------------------------------
	// Phase A5 — staging promotion + preservation systemMessage.
	// -----------------------------------------------------------------------

	it("invokes staging promotion and reports staging counts", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pre-compact-staging-promotion", tmpDir);

		// One staged fact above Tier-4 threshold → should promote.
		await insertStagedFact(db, {
			proposed_type: "Convention",
			proposed_name: "Phase A5 promote",
			proposed_content:
				"A convention captured during the session that survived confirmatory signals.",
			trust_tier: 4,
			raw_confidence: 0.92,
		});
		// One below threshold → should stay pending (kept).
		await insertStagedFact(db, {
			proposed_type: "Concept",
			proposed_name: "Phase A5 keep",
			proposed_content: "Something tentative.",
			trust_tier: 4,
			raw_confidence: 0.5,
		});

		const handler = createPreCompactHandler(db);
		const transcriptPath = writeTranscript(tmpDir, [{ role: "user", content: "hi" }]);
		const event = baseEvent({
			hook_event_name: "PreCompact",
			transcript_path: transcriptPath,
			session_id: "phase-a5-staging",
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.staging_promoted).toBe(1);
		expect(result.staging_kept).toBe(1);
		expect(result.staging_rejected).toBe(0);
	});

	it("emits systemMessage containing top-5 Preferences + top-3 Episodes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pre-compact-preserve-msg", tmpDir);

		const now = Date.now();
		// 6 Preferences (only top 5 by t_valid_from DESC should appear).
		for (let i = 0; i < 6; i++) {
			await insertEntity(db, {
				type: "Preference",
				kind: "Preference",
				name: `Preference ${i}`,
				content: `Preference body ${i}`,
				summary: `Preference summary ${i}`,
				t_valid_from: now + i, // later i = newer
			});
		}
		// 4 Episodes (only top 3 should appear).
		for (let i = 0; i < 4; i++) {
			await insertEntity(db, {
				type: "Episode",
				kind: "Episode",
				name: `Episode ${i}`,
				content: `Episode body ${i}`,
				summary: `Episode summary ${i}`,
				t_valid_from: now + i,
			});
		}

		const handler = createPreCompactHandler(db);
		const transcriptPath = writeTranscript(tmpDir, [{ role: "user", content: "hi" }]);
		const event = baseEvent({
			hook_event_name: "PreCompact",
			transcript_path: transcriptPath,
			session_id: "phase-a5-preserve",
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(typeof result.systemMessage).toBe("string");

		const msg = result.systemMessage as string;
		expect(msg).toContain("Keep verbatim across compaction:");

		// Exactly 5 Preference bullets.
		const prefMatches = msg.match(/\[Preference\]/g) ?? [];
		expect(prefMatches).toHaveLength(5);

		// Exactly 3 Episode bullets.
		const epMatches = msg.match(/\[Episode\]/g) ?? [];
		expect(epMatches).toHaveLength(3);

		// Newest first: Preference 5 kept, Preference 0 dropped.
		expect(msg).toContain("Preference 5");
		expect(msg).not.toContain("Preference 0");
		// Episode 3 kept, Episode 0 dropped.
		expect(msg).toContain("Episode 3");
		expect(msg).not.toContain("Episode 0");

		// Every line ≤ 150 chars.
		for (const line of msg.split("\n")) {
			expect(line.length).toBeLessThanOrEqual(150);
		}
	});

	it("empty graph → no systemMessage field", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pre-compact-empty-preserve", tmpDir);

		const handler = createPreCompactHandler(db);
		const transcriptPath = writeTranscript(tmpDir, [{ role: "user", content: "hi" }]);
		const event = baseEvent({
			hook_event_name: "PreCompact",
			transcript_path: transcriptPath,
			session_id: "phase-a5-empty",
		});

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.systemMessage).toBeUndefined();
	});

	it("missing memory_staging table → helper is a safe no-op; hook still succeeds", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pre-compact-staging-missing", tmpDir);

		// Simulate the documented "schema lacks staging columns" case.
		await db.execute("DROP TABLE memory_staging");

		const handler = createPreCompactHandler(db);
		const transcriptPath = writeTranscript(tmpDir, [{ role: "user", content: "hi" }]);
		const event = baseEvent({
			hook_event_name: "PreCompact",
			transcript_path: transcriptPath,
			session_id: "phase-a5-missing-table",
		});

		const result = await handler(event);
		// Hook must still succeed — compaction cannot be blocked.
		expect(result.status).toBe("processed");
		expect(result.staging_promoted).toBe(0);
		expect(result.staging_kept).toBe(0);
		expect(result.staging_rejected).toBe(0);
	});

	it("unexpected staging throw is caught, logged to stderr, and does not break the hook", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pre-compact-staging-failure", tmpDir);

		// Stage a high-confidence clean fact that will pass injection + threshold
		// gates and enter the promotion path. Then stub db.execute to throw the
		// moment the consolidation pipeline issues its first UPDATE/INSERT, forcing
		// an unexpected error to escape `promoteStagedEntities`'s internal guards.
		await insertStagedFact(db, {
			proposed_type: "Convention",
			proposed_name: "A clean fact",
			proposed_content: "A convention captured from normal session dialog with full support.",
			trust_tier: 4,
			raw_confidence: 0.95,
		});

		const originalExecute = db.execute.bind(db);
		const execSpy = vi
			.spyOn(db, "execute")
			.mockImplementation(async (sql: string, params?: unknown[]) => {
				// Let reads through so the helper reaches the loop body, then throw
				// on the first write the loop attempts.
				const isWrite =
					sql.trim().toUpperCase().startsWith("UPDATE") ||
					sql.trim().toUpperCase().startsWith("INSERT");
				const touchesStagingOrGraph = sql.includes("memory_staging") || sql.includes("graph_nodes");
				if (isWrite && touchesStagingOrGraph) {
					throw new Error("simulated unexpected staging write failure");
				}
				return originalExecute(sql, params);
			});
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		try {
			const handler = createPreCompactHandler(db);
			const transcriptPath = writeTranscript(tmpDir, [{ role: "user", content: "hi" }]);
			const event = baseEvent({
				hook_event_name: "PreCompact",
				transcript_path: transcriptPath,
				session_id: "phase-a5-failure",
			});

			const result = await handler(event);
			// Hook must still succeed — compaction cannot be blocked.
			expect(result.status).toBe("processed");

			// Error surfaced on stderr with the sia:pre-compact prefix.
			const stderrCalls = stderrSpy.mock.calls
				.map((c) => String(c[0]))
				.filter((s) => s.includes("sia:pre-compact"));
			expect(stderrCalls.length).toBeGreaterThanOrEqual(1);
			expect(stderrCalls.join("\n")).toContain("promoteStagedEntities failed");
		} finally {
			execSpy.mockRestore();
			stderrSpy.mockRestore();
		}
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
