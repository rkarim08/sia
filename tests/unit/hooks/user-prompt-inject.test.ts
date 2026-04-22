// Tests for UserPromptSubmit retrieval + Concern injection (Phase A4).
//
// Covers:
//   (a) short prompts (< 20 chars) skip retrieval entirely
//   (b) a normal prompt returns additionalContext with a graph-context block
//       when BM25/graph-traversal finds at least one match
//   (c) a prompt matching an open Concern appends an "Open concerns" section
//   (d) no search hits and no concerns return `additionalContext: undefined`

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { classifyTaskType, handleUserPromptSubmit } from "@/hooks/handlers/user-prompt-submit";
import { clearTurnMemo } from "@/hooks/memoize";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("handleUserPromptSubmit — injection", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		clearTurnMemo();
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("skips retrieval for prompts shorter than 20 chars", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-inject-short", tmpDir);

		// Seed a matching entity so retrieval WOULD hit it if it ran.
		await insertEntity(db, {
			type: "Concept",
			name: "retrieval subsystem",
			content: "discusses retrieval subsystem internals",
			summary: "retrieval subsystem summary",
			tags: "[]",
			kind: "Convention",
		});

		const result = await handleUserPromptSubmit(
			db,
			{ session_id: "s-short", prompt: "fix bug" }, // 7 chars
			{} as never,
		);

		expect(result.nodesCreated).toBe(1);
		expect(result.additionalContext).toBeUndefined();
	});

	it("returns additionalContext with graph-context block when matches exist", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-inject-hit", tmpDir);

		// Seed a distinctive entity so BM25 will find it.
		await insertEntity(db, {
			type: "Concept",
			name: "widget pipeline overview",
			content:
				"The widget pipeline ingests widget events and materialises widget summaries for downstream consumers.",
			summary: "widget pipeline summary",
			tags: "[]",
			kind: "Convention",
			trust_tier: 2,
		});

		const result = await handleUserPromptSubmit(
			db,
			{
				session_id: "s-hit",
				prompt: "Explain how the widget pipeline handles widget events end-to-end",
			},
			{} as never,
		);

		expect(result.nodesCreated).toBe(1);
		expect(result.additionalContext).toBeDefined();
		expect(result.additionalContext).toContain("## Relevant graph entities");
		expect(result.additionalContext).toContain("widget pipeline overview");
	});

	it("appends Open Concerns block for concerns matching a prompt keyword", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-inject-concern", tmpDir);

		// A generic entity so the search block is also populated.
		await insertEntity(db, {
			type: "Concept",
			name: "authentication module notes",
			content: "Notes on the authentication module token lifecycle.",
			summary: "auth module token lifecycle",
			tags: "[]",
			kind: "Convention",
		});

		// An open Concern whose name/summary contains "authentication".
		await insertEntity(db, {
			type: "Concept",
			name: "authentication drift risk",
			content: "Concern that authentication token rotation drifts over time.",
			summary: "auth rotation drift concern",
			tags: JSON.stringify(["status:open"]),
			kind: "Concern",
			confidence: 0.8,
		});

		const result = await handleUserPromptSubmit(
			db,
			{
				session_id: "s-concern",
				prompt: "Review the authentication rotation policy and token lifecycle",
			},
			{} as never,
		);

		expect(result.additionalContext).toBeDefined();
		expect(result.additionalContext).toContain("## Open concerns");
		expect(result.additionalContext).toContain("authentication drift risk");
	});

	it("returns additionalContext undefined when there are zero hits", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-inject-empty", tmpDir);

		// Empty graph — no entities, no concerns.
		const result = await handleUserPromptSubmit(
			db,
			{
				session_id: "s-empty",
				prompt: "Please explain the deep learning subsystem architecture and gradients",
			},
			{} as never,
		);

		expect(result.nodesCreated).toBe(1); // the UserPrompt itself got inserted
		expect(result.additionalContext).toBeUndefined();
	});

	it("result exposes pendingBackgroundWork which always resolves cleanly", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-inject-pending", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "pending work seed",
			content: "A seed entity so search has at least one candidate.",
			summary: "pending work seed summary",
			tags: "[]",
			kind: "Convention",
		});

		const result = await handleUserPromptSubmit(
			db,
			{
				session_id: "s-pending",
				prompt: "Describe the pending work seed and how it integrates end-to-end",
			},
			{} as never,
		);

		expect(result.pendingBackgroundWork).toBeInstanceOf(Promise);
		// Always resolves (never rejects) — the background handler swallows
		// any post-timeout errors so the caller can `await` safely before
		// closing the DB.
		await expect(result.pendingBackgroundWork).resolves.toBeUndefined();

		// Simulate the plugin wrapper's `finally { await db.close() }` and
		// confirm no "database closed" error is thrown after awaiting
		// pendingBackgroundWork first.
		await result.pendingBackgroundWork;
		await expect(db.close()).resolves.toBeUndefined();
		db = undefined; // prevent afterEach double-close
	});

	it("short prompt returns an already-resolved pendingBackgroundWork", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-inject-noop", tmpDir);

		const result = await handleUserPromptSubmit(
			db,
			{ session_id: "s-noop", prompt: "fix bug" }, // < 20 chars
			{} as never,
		);

		expect(result.additionalContext).toBeUndefined();
		await expect(result.pendingBackgroundWork).resolves.toBeUndefined();
	});

	describe("classifyTaskType", () => {
		it("tags bug-fix keywords", () => {
			expect(classifyTaskType("fix the failing tests")).toBe("bug-fix");
			expect(classifyTaskType("500 error in the API")).toBe("bug-fix");
		});
		it("tags feature keywords", () => {
			expect(classifyTaskType("implement a new endpoint")).toBe("feature");
			expect(classifyTaskType("add support for sqlite")).toBe("feature");
		});
		it("tags review keywords", () => {
			expect(classifyTaskType("review my pull request")).toBe("review");
			expect(classifyTaskType("check code style standards")).toBe("review");
		});
		it("returns trivial for ambiguous prompts", () => {
			expect(classifyTaskType("hello there friend")).toBe("trivial");
		});
	});
});
