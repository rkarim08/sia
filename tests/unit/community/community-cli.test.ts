import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatCommunityTree } from "@/cli/commands/community";
import { detectCommunities } from "@/community/leiden";
import { summarizeCommunities } from "@/community/summarize";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

async function seedGraph(db: SiaDb) {
	const ids: string[] = [];
	for (let i = 0; i < 5; i++) {
		const entity = await insertEntity(db, {
			type: "Function",
			name: `cli-entity-${i}`,
			content: `content-${i}`,
			summary: `summary-${i}`,
		});
		ids.push(entity.id);
	}
	for (let i = 0; i < ids.length - 1; i++) {
		await insertEdge(db, { from_id: ids[i], to_id: ids[i + 1], type: "calls", weight: 1 });
	}
}

describe("community CLI formatter", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("renders a human-readable tree with entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("cli-repo", tmpDir);
		await seedGraph(db);
		await detectCommunities(db);
		await summarizeCommunities(db, { airGapped: false });

		const output = await formatCommunityTree(db);
		expect(output).toContain("Community");
		expect(output).toContain("members");
		expect(output).toMatch(/- cli-entity-/);
		// Verify indentation pattern for nested items
		expect(output).toMatch(/\s{2}-/);
	});
});
