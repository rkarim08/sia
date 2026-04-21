import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { CLAUDE_MD_PREFERENCES, seedPreferences } from "@/nous/preference-seeder";

function makeTmp(): string {
	return join(tmpdir(), `nous-seed-${randomUUID()}`);
}

describe("preference-seeder", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	it("inserts CLAUDE_MD_PREFERENCES on first run", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-seed", tmpDir);
		const inserted = seedPreferences(db);
		expect(inserted).toBe(CLAUDE_MD_PREFERENCES.length);

		const raw = db.rawSqlite();
		expect(raw).not.toBeNull();
		const rows = raw!
			.prepare("SELECT name, trust_tier FROM graph_nodes WHERE kind = 'Preference'")
			.all() as Array<{ name: string; trust_tier: number }>;
		expect(rows.length).toBe(CLAUDE_MD_PREFERENCES.length);
		for (const pref of CLAUDE_MD_PREFERENCES) {
			const match = rows.find((r) => r.name === pref.name);
			expect(match).toBeDefined();
			expect(match?.trust_tier).toBe(pref.trust_tier);
		}
	});

	it("is idempotent — second run inserts zero rows", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-seed2", tmpDir);
		expect(seedPreferences(db)).toBe(CLAUDE_MD_PREFERENCES.length);
		expect(seedPreferences(db)).toBe(0);
	});
});
