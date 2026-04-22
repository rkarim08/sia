import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { getActiveEntities } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { handleUserPromptSubmit } from "@/hooks/handlers/user-prompt-submit";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("handleUserPromptSubmit", () => {
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

	it("empty prompt returns nodesCreated 0", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-empty", tmpDir);

		const result = await handleUserPromptSubmit(db, { session_id: "s1", prompt: "" }, {} as never);
		expect(result.nodesCreated).toBe(0);

		const entities = await getActiveEntities(db);
		expect(entities).toHaveLength(0);
	});

	it("whitespace-only prompt returns nodesCreated 0", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-whitespace", tmpDir);

		const result = await handleUserPromptSubmit(
			db,
			{ session_id: "s1", prompt: "   \t\n  " },
			{} as never,
		);
		expect(result.nodesCreated).toBe(0);
	});

	it("normal prompt creates 1 UserPrompt node", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-normal", tmpDir);

		const result = await handleUserPromptSubmit(
			db,
			{ session_id: "s1", prompt: "What does this function do?" },
			{} as never,
		);
		expect(result.nodesCreated).toBe(1);
		// Trivial/short classifier result is still returned.
		expect(result.taskType).toBeDefined();

		const entities = await getActiveEntities(db);
		expect(entities).toHaveLength(1);
		expect(entities[0].kind).toBe("UserPrompt");
		expect(entities[0].session_id).toBe("s1");
	});

	it("correction prompt creates UserPrompt + UserDecision (2 nodes)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-correction", tmpDir);

		const result = await handleUserPromptSubmit(
			db,
			{
				session_id: "s2",
				prompt: "use TypeScript instead of JavaScript",
			},
			{} as never,
		);
		expect(result.nodesCreated).toBe(2);

		const entities = await getActiveEntities(db);
		expect(entities).toHaveLength(2);

		const kinds = entities.map((e) => e.kind).sort();
		expect(kinds).toEqual(["UserDecision", "UserPrompt"]);
	});

	it("UserDecision has trust_tier 1 and kind UserDecision", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-decision-fields", tmpDir);

		await handleUserPromptSubmit(
			db,
			{ session_id: "s3", prompt: "don't use var declarations" },
			{} as never,
		);

		const entities = await getActiveEntities(db);
		const decision = entities.find((e) => e.kind === "UserDecision");
		expect(decision).toBeDefined();
		expect(decision?.trust_tier).toBe(1);
		expect(decision?.kind).toBe("UserDecision");
		expect(decision?.type).toBe("Decision");
	});

	it("multiple correction patterns in one prompt → only 1 UserDecision", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-multi-pattern", tmpDir);

		const result = await handleUserPromptSubmit(
			db,
			{
				session_id: "s4",
				// Contains: "always use", "never use", "don't use" — multiple patterns
				prompt: "always use const and never use var and don't use let",
			},
			{} as never,
		);
		// 1 UserPrompt + 1 UserDecision = 2 total
		expect(result.nodesCreated).toBe(2);

		const entities = await getActiveEntities(db);
		const decisions = entities.filter((e) => e.kind === "UserDecision");
		expect(decisions).toHaveLength(1);
	});

	it("'prefer' pattern triggers UserDecision", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-prefer", tmpDir);

		const result = await handleUserPromptSubmit(
			db,
			{ session_id: "s5", prompt: "prefer async/await over callbacks" },
			{} as never,
		);
		expect(result.nodesCreated).toBe(2);
	});

	it("'switch to' pattern triggers UserDecision", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ups-switch", tmpDir);

		const result = await handleUserPromptSubmit(
			db,
			{ session_id: "s6", prompt: "switch to Bun from Node.js" },
			{} as never,
		);
		expect(result.nodesCreated).toBe(2);
	});
});
