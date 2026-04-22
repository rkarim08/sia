// Unit tests for src/nous/surprise-router.ts
//
// The router is a thin wrapper around the cross-encoder. Tests inject a fake
// reranker via `opts.reranker` so that we never touch ONNX at test time — the
// cross-encoder's own behaviour is covered by tests/unit/retrieval/*.

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import {
	__resetSurpriseRouterForTests,
	runSurpriseRouter,
	SURPRISE_CE_TIMEOUT_MS,
} from "@/nous/surprise-router";
import { DEFAULT_SESSION_STATE } from "@/nous/types";
import { upsertSession } from "@/nous/working-memory";
import type { CrossEncoderReranker } from "@/retrieval/cross-encoder";

function makeTmp(): string {
	return join(tmpdir(), `nous-sr-${randomUUID()}`);
}

function seedSession(db: SiaDb, sessionId: string): void {
	const now = Math.floor(Date.now() / 1000);
	upsertSession(db, {
		session_id: sessionId,
		parent_session_id: null,
		session_type: "primary",
		state: { ...DEFAULT_SESSION_STATE },
		created_at: now,
		updated_at: now,
	});
}

function fakeReranker(score: number): CrossEncoderReranker {
	return {
		modelName: "fake-ce",
		async rerank(_query, candidates) {
			return candidates.map((c) => ({ entityId: c.entityId, score }));
		},
	};
}

function delayedReranker(score: number, delayMs: number): CrossEncoderReranker {
	return {
		modelName: "fake-slow-ce",
		async rerank(_query, candidates) {
			await new Promise((r) => setTimeout(r, delayMs));
			return candidates.map((c) => ({ entityId: c.entityId, score }));
		},
	};
}

describe("surprise-router", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
		__resetSurpriseRouterForTests();
	});

	it("(a) Write tool skips scoring (unsupported-tool)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sr-write", tmpDir);
		seedSession(db, "sess-write");

		// Inject a reranker that would throw if called — proves we never got there.
		const hot: CrossEncoderReranker = {
			modelName: "should-not-run",
			async rerank() {
				throw new Error("reranker called for Write — should be unreachable");
			},
		};

		const result = await runSurpriseRouter(
			db,
			{
				session_id: "sess-write",
				tool_name: "Write",
				tool_input: { file_path: "/tmp/x.ts", content: "hello" },
				tool_response: { success: true },
			},
			undefined,
			{ reranker: hot },
		);

		expect(result.surpriseDetected).toBe(false);
		expect(result.skippedReason).toBe("unsupported-tool");
	});

	it("(b) Bash with low cross-encoder score writes a Signal node", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sr-bash-low", tmpDir);
		const sessionId = "sess-bash-low";
		seedSession(db, sessionId);

		const result = await runSurpriseRouter(
			db,
			{
				session_id: sessionId,
				tool_name: "Bash",
				tool_input: { command: "ls /etc" },
				tool_response: { output: "ERROR: disk unreadable segmentation fault" },
			},
			undefined,
			{ reranker: fakeReranker(0.05) },
		);

		expect(result.surpriseDetected).toBe(true);
		expect(result.signalNodeId).toBeTruthy();
		expect(result.score).toBeCloseTo(0.05, 5);

		const raw = db.rawSqlite();
		expect(raw).not.toBeNull();
		if (!raw) return;
		const signals = raw
			.prepare(
				"SELECT id, name, kind, captured_by_session_id FROM graph_nodes WHERE kind = 'Signal' AND captured_by_session_id = ?",
			)
			.all(sessionId) as Array<Record<string, unknown>>;
		expect(signals.length).toBe(1);
		expect(signals[0].name).toBe("surprise:bash");
	});

	it("(c) Bash with high cross-encoder score does NOT fire", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sr-bash-high", tmpDir);
		const sessionId = "sess-bash-high";
		seedSession(db, sessionId);

		const result = await runSurpriseRouter(
			db,
			{
				session_id: sessionId,
				tool_name: "Bash",
				tool_input: { command: "echo hello" },
				tool_response: { output: "hello" },
			},
			undefined,
			{ reranker: fakeReranker(0.92) },
		);

		expect(result.surpriseDetected).toBe(false);
		expect(result.signalNodeId).toBeUndefined();
		expect(result.score).toBeCloseTo(0.92, 5);

		const raw = db.rawSqlite();
		if (!raw) return;
		const signals = raw
			.prepare("SELECT id FROM graph_nodes WHERE kind = 'Signal' AND captured_by_session_id = ?")
			.all(sessionId);
		expect(signals.length).toBe(0);
	});

	it("(d) cross-encoder timeout → no Signal, stderr logged", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sr-timeout", tmpDir);
		const sessionId = "sess-timeout";
		seedSession(db, sessionId);

		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		// Rerank takes 50ms but the timeout budget is 5ms.
		const result = await runSurpriseRouter(
			db,
			{
				session_id: sessionId,
				tool_name: "Bash",
				tool_input: { command: "sleep 1" },
				tool_response: { output: "done" },
			},
			undefined,
			{ reranker: delayedReranker(0.1, 50), timeoutMs: 5 },
		);

		expect(result.surpriseDetected).toBe(false);
		expect(result.skippedReason).toBe("timeout");
		expect(result.score).toBeNull();

		const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
		expect(calls.some((msg) => msg.includes("surprise-router") && msg.includes("exceeded"))).toBe(
			true,
		);
		stderrSpy.mockRestore();

		// The default budget is generous enough to not mask real errors.
		expect(SURPRISE_CE_TIMEOUT_MS).toBeGreaterThanOrEqual(100);
	});

	it("(e) cross-encoder load failure (reranker null) → fail-open, stderr logged via throwing reranker", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sr-load-fail", tmpDir);
		const sessionId = "sess-load-fail";
		seedSession(db, sessionId);

		// Case 1: reranker explicitly null (no model installed) — silent fail-open.
		const nullResult = await runSurpriseRouter(
			db,
			{
				session_id: sessionId,
				tool_name: "Bash",
				tool_input: { command: "ls" },
				tool_response: { output: "a\nb\nc" },
			},
			undefined,
			{ reranker: null },
		);
		expect(nullResult.surpriseDetected).toBe(false);
		expect(nullResult.skippedReason).toBe("no-reranker");

		// Case 2: reranker throws on call — fail-open with stderr.
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const throwing: CrossEncoderReranker = {
			modelName: "throws",
			async rerank() {
				throw new Error("model load race failure");
			},
		};
		const throwResult = await runSurpriseRouter(
			db,
			{
				session_id: sessionId,
				tool_name: "Bash",
				tool_input: { command: "ls" },
				tool_response: { output: "a" },
			},
			undefined,
			{ reranker: throwing },
		);
		expect(throwResult.surpriseDetected).toBe(false);
		expect(throwResult.skippedReason).toBe("error");

		const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
		expect(
			calls.some((msg) => msg.includes("surprise-router") && msg.includes("cross-encoder error")),
		).toBe(true);
		stderrSpy.mockRestore();
	});

	it("Grep scores (pattern, top hit)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sr-grep", tmpDir);
		const sessionId = "sess-grep";
		seedSession(db, sessionId);

		const result = await runSurpriseRouter(
			db,
			{
				session_id: sessionId,
				tool_name: "Grep",
				tool_input: { pattern: "createCrossEncoderReranker" },
				tool_response: { filenames: ["src/retrieval/cross-encoder.ts"] },
			},
			undefined,
			{ reranker: fakeReranker(0.85) },
		);

		expect(result.skippedReason).toBeNull();
		expect(result.surpriseDetected).toBe(false);
		expect(result.score).toBeCloseTo(0.85, 5);
	});

	it("returns no-session when session is missing", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sr-no-session", tmpDir);

		const result = await runSurpriseRouter(
			db,
			{
				session_id: "ghost",
				tool_name: "Bash",
				tool_input: { command: "ls" },
				tool_response: { output: "x" },
			},
			undefined,
			{ reranker: fakeReranker(0.1) },
		);

		expect(result.surpriseDetected).toBe(false);
		expect(result.skippedReason).toBe("no-session");
	});
});
