import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { getUnconsumedFlags, markFlagConsumed } from "@/graph/flags";
import { openGraphDb } from "@/graph/semantic-db";

describe("session flags CRUD", () => {
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
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// Helper to insert a flag directly via db.execute
	async function insertFlag(
		database: SiaDb,
		opts: {
			id?: string;
			session_id?: string;
			reason?: string;
			transcript_position?: number | null;
			created_at?: number;
			consumed?: number;
		},
	): Promise<void> {
		const id = opts.id ?? randomUUID();
		const sessionId = opts.session_id ?? "sess-1";
		const reason = opts.reason ?? "test flag";
		const transcriptPosition = opts.transcript_position ?? null;
		const createdAt = opts.created_at ?? Date.now();
		const consumed = opts.consumed ?? 0;

		await database.execute(
			"INSERT INTO session_flags (id, session_id, reason, transcript_position, created_at, consumed) VALUES (?, ?, ?, ?, ?, ?)",
			[id, sessionId, reason, transcriptPosition, createdAt, consumed],
		);
	}

	// ---------------------------------------------------------------
	// getUnconsumedFlags returns flags with consumed=0
	// ---------------------------------------------------------------

	it("getUnconsumedFlags returns flags with consumed=0", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("flags-unconsumed", tmpDir);

		await insertFlag(db, { id: "f1", session_id: "sess-1", reason: "reason-a", created_at: 1000 });
		await insertFlag(db, { id: "f2", session_id: "sess-1", reason: "reason-b", created_at: 2000 });

		const flags = await getUnconsumedFlags(db, "sess-1");

		expect(flags).toHaveLength(2);
		expect(flags[0]?.id).toBe("f1");
		expect(flags[0]?.session_id).toBe("sess-1");
		expect(flags[0]?.reason).toBe("reason-a");
		expect(flags[0]?.consumed).toBe(0);
		expect(flags[1]?.id).toBe("f2");
		expect(flags[1]?.reason).toBe("reason-b");
	});

	// ---------------------------------------------------------------
	// getUnconsumedFlags excludes consumed flags
	// ---------------------------------------------------------------

	it("getUnconsumedFlags excludes consumed flags", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("flags-exclude-consumed", tmpDir);

		await insertFlag(db, { id: "f1", session_id: "sess-1", consumed: 0, created_at: 1000 });
		await insertFlag(db, { id: "f2", session_id: "sess-1", consumed: 1, created_at: 2000 });
		await insertFlag(db, { id: "f3", session_id: "sess-1", consumed: 0, created_at: 3000 });

		const flags = await getUnconsumedFlags(db, "sess-1");

		expect(flags).toHaveLength(2);
		expect(flags.map((f) => f.id)).toEqual(["f1", "f3"]);
	});

	// ---------------------------------------------------------------
	// markFlagConsumed sets consumed=1
	// ---------------------------------------------------------------

	it("markFlagConsumed sets consumed=1", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("flags-mark-consumed", tmpDir);

		await insertFlag(db, { id: "f1", session_id: "sess-1", consumed: 0 });

		await markFlagConsumed(db, "f1");

		const result = await db.execute("SELECT consumed FROM session_flags WHERE id = ?", ["f1"]);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.consumed).toBe(1);

		// Also confirm it no longer shows up in unconsumed query
		const flags = await getUnconsumedFlags(db, "sess-1");
		expect(flags).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// getUnconsumedFlags filters by sessionId
	// ---------------------------------------------------------------

	it("getUnconsumedFlags filters by sessionId", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("flags-filter-session", tmpDir);

		await insertFlag(db, { id: "f1", session_id: "sess-A", reason: "for-A", created_at: 1000 });
		await insertFlag(db, { id: "f2", session_id: "sess-B", reason: "for-B", created_at: 2000 });
		await insertFlag(db, {
			id: "f3",
			session_id: "sess-A",
			reason: "also-for-A",
			created_at: 3000,
		});

		const flagsA = await getUnconsumedFlags(db, "sess-A");
		expect(flagsA).toHaveLength(2);
		expect(flagsA.map((f) => f.id)).toEqual(["f1", "f3"]);

		const flagsB = await getUnconsumedFlags(db, "sess-B");
		expect(flagsB).toHaveLength(1);
		expect(flagsB[0]?.id).toBe("f2");
	});
});
