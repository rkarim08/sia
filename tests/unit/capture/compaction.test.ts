import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compactSession } from "@/capture/pipeline";
import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { DEFAULT_CONFIG, type SiaConfig } from "@/shared/config";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeConfig(overrides: Partial<SiaConfig> = {}): SiaConfig {
	return { ...DEFAULT_CONFIG, ...overrides };
}

describe("compactSession", () => {
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

	// ---------------------------------------------------------------
	// Compaction creates entity when content exceeds budget
	// ---------------------------------------------------------------

	it("creates entity when content exceeds token budget", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("compact-over", tmpDir);

		// workingMemoryTokenBudget = 100 tokens. At ~4 chars/token, we need > 400 chars.
		const config = makeConfig({ workingMemoryTokenBudget: 100 });
		const longContent = "A".repeat(500); // 500 chars = ~125 tokens > 100

		await compactSession(db, longContent, config);

		const result = await db.execute(
			"SELECT * FROM entities WHERE type = 'Concept' AND t_valid_until IS NULL AND archived_at IS NULL",
		);
		expect(result.rows).toHaveLength(1);

		const entity = result.rows[0] as Entity;
		expect(entity.type).toBe("Concept");
		expect(JSON.parse(entity.tags)).toEqual(["session-compaction"]);
		// Summary should be first 200 chars
		expect(entity.content).toBe("A".repeat(200));
	});

	// ---------------------------------------------------------------
	// No entity created when content is short
	// ---------------------------------------------------------------

	it("does not create entity when content is within budget", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("compact-under", tmpDir);

		// workingMemoryTokenBudget = 8000. Short content = ~10 tokens.
		const config = makeConfig({ workingMemoryTokenBudget: 8000 });
		const shortContent = "A short session content that is well within budget.";

		await compactSession(db, shortContent, config);

		const result = await db.execute(
			"SELECT * FROM entities WHERE type = 'Concept' AND t_valid_until IS NULL AND archived_at IS NULL",
		);
		expect(result.rows).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// Edge case: exactly at the budget threshold
	// ---------------------------------------------------------------

	it("does not compact when tokens equal the budget exactly", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("compact-exact", tmpDir);

		// Budget = 100 tokens. 100 * 4 = 400 chars exactly.
		const config = makeConfig({ workingMemoryTokenBudget: 100 });
		const exactContent = "B".repeat(400);

		await compactSession(db, exactContent, config);

		const result = await db.execute(
			"SELECT * FROM entities WHERE type = 'Concept' AND t_valid_until IS NULL AND archived_at IS NULL",
		);
		expect(result.rows).toHaveLength(0);
	});
});
