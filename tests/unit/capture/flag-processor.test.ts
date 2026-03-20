import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processFlags } from "@/capture/flag-processor";
import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";
import { getUnconsumedFlags } from "@/graph/flags";
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

async function insertFlag(
	db: SiaDb,
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

	await db.execute(
		"INSERT INTO session_flags (id, session_id, reason, transcript_position, created_at, consumed) VALUES (?, ?, ?, ?, ?, ?)",
		[id, sessionId, reason, transcriptPosition, createdAt, consumed],
	);
}

describe("processFlags", () => {
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
	// Returns 0 when enableFlagging=false
	// ---------------------------------------------------------------

	it("returns 0 when enableFlagging is false", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("fp-disabled", tmpDir);

		await insertFlag(db, { session_id: "sess-1", reason: "should be ignored" });

		const config = makeConfig({ enableFlagging: false });
		const count = await processFlags(db, "sess-1", config);

		expect(count).toBe(0);

		// Flag should remain unconsumed
		const flags = await getUnconsumedFlags(db, "sess-1");
		expect(flags).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// Processes unconsumed flags and returns count
	// ---------------------------------------------------------------

	it("processes unconsumed flags and returns count", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("fp-count", tmpDir);

		await insertFlag(db, { id: "f1", session_id: "sess-1", reason: "flag one", created_at: 1000 });
		await insertFlag(db, { id: "f2", session_id: "sess-1", reason: "flag two", created_at: 2000 });
		await insertFlag(db, {
			id: "f3",
			session_id: "sess-1",
			reason: "flag three",
			created_at: 3000,
		});

		const config = makeConfig({ enableFlagging: true });
		const count = await processFlags(db, "sess-1", config);

		expect(count).toBe(3);
	});

	// ---------------------------------------------------------------
	// Marks flags as consumed after processing
	// ---------------------------------------------------------------

	it("marks flags as consumed after processing", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("fp-consumed", tmpDir);

		await insertFlag(db, {
			id: "f1",
			session_id: "sess-1",
			reason: "consume me",
			created_at: 1000,
		});
		await insertFlag(db, {
			id: "f2",
			session_id: "sess-1",
			reason: "consume me too",
			created_at: 2000,
		});

		const config = makeConfig({ enableFlagging: true });
		await processFlags(db, "sess-1", config);

		// All flags should now be consumed
		const flags = await getUnconsumedFlags(db, "sess-1");
		expect(flags).toHaveLength(0);

		// Verify consumed=1 directly
		const result = await db.execute("SELECT consumed FROM session_flags ORDER BY created_at");
		for (const row of result.rows) {
			expect((row as { consumed: number }).consumed).toBe(1);
		}
	});

	// ---------------------------------------------------------------
	// Creates entities from flag reasons
	// ---------------------------------------------------------------

	it("creates entities from flag reasons", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("fp-entities", tmpDir);

		await insertFlag(db, {
			id: "f1",
			session_id: "sess-1",
			reason: "Important architectural decision about microservices",
			created_at: 1000,
		});

		const config = makeConfig({ enableFlagging: true });
		await processFlags(db, "sess-1", config);

		// Verify an entity was created
		const entities = await db.execute(
			"SELECT * FROM graph_nodes WHERE type = 'Concept' AND t_valid_until IS NULL AND archived_at IS NULL",
		);
		expect(entities.rows.length).toBeGreaterThanOrEqual(1);

		const entity = entities.rows[0] as unknown as Entity;
		expect(entity.type).toBe("Concept");
		expect(entity.name).toBe("Important architectural decision about microservic");
		expect(entity.content).toBe("Important architectural decision about microservices");
		expect(entity.summary).toBe("Important architectural decision about microservices");
		expect(entity.trust_tier).toBe(1);
		expect(JSON.parse(entity.tags)).toEqual(["session-flag"]);
	});

	// ---------------------------------------------------------------
	// Uses flaggedConfidenceThreshold (0.4) not default
	// ---------------------------------------------------------------

	it("uses flaggedConfidenceThreshold not default confidence", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("fp-confidence", tmpDir);

		await insertFlag(db, {
			id: "f1",
			session_id: "sess-1",
			reason: "threshold test flag",
			created_at: 1000,
		});

		const config = makeConfig({
			enableFlagging: true,
			flaggedConfidenceThreshold: 0.4,
		});
		await processFlags(db, "sess-1", config);

		const entities = await db.execute(
			"SELECT confidence FROM graph_nodes WHERE type = 'Concept' AND t_valid_until IS NULL AND archived_at IS NULL",
		);
		expect(entities.rows).toHaveLength(1);
		expect((entities.rows[0] as unknown as Entity).confidence).toBe(0.4);
	});

	// ---------------------------------------------------------------
	// Applies flaggedImportanceBoost to entity importance
	// ---------------------------------------------------------------

	it("applies flaggedImportanceBoost to entity base_importance", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("fp-importance", tmpDir);

		await insertFlag(db, {
			id: "f1",
			session_id: "sess-1",
			reason: "boosted importance flag",
			created_at: 1000,
		});

		const config = makeConfig({
			enableFlagging: true,
			flaggedImportanceBoost: 0.15,
		});
		await processFlags(db, "sess-1", config);

		const entities = await db.execute(
			"SELECT base_importance, importance FROM graph_nodes WHERE type = 'Concept' AND t_valid_until IS NULL AND archived_at IS NULL",
		);
		expect(entities.rows).toHaveLength(1);
		const entity = entities.rows[0] as unknown as Entity;
		// Default base_importance (0.5) + boost (0.15) = 0.65
		expect(entity.base_importance).toBeCloseTo(0.65, 5);
		expect(entity.importance).toBeCloseTo(0.65, 5);
	});
});
