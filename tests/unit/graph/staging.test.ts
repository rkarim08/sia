import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import {
	expireStaleStagedFacts,
	getPendingStagedFacts,
	insertStagedFact,
	updateStagingStatus,
} from "@/graph/staging";

describe("staging area CRUD", () => {
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

	// ---------------------------------------------------------------
	// 1. insertStagedFact creates row with correct fields
	// ---------------------------------------------------------------

	it("insertStagedFact creates row with correct fields", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("staging-insert", tmpDir);

		const id = await insertStagedFact(db, {
			source_episode: "ep-1",
			proposed_type: "Convention",
			proposed_name: "Use strict mode",
			proposed_content: "All TypeScript files should use strict mode.",
			proposed_tags: '["typescript","strict"]',
			proposed_file_paths: '["tsconfig.json"]',
			trust_tier: 4,
			raw_confidence: 0.85,
		});

		expect(id).toBeDefined();
		expect(typeof id).toBe("string");

		const result = await db.execute("SELECT * FROM memory_staging WHERE id = ?", [id]);
		expect(result.rows).toHaveLength(1);

		const row = result.rows[0] as Record<string, unknown>;
		expect(row.id).toBe(id);
		expect(row.source_episode).toBe("ep-1");
		expect(row.proposed_type).toBe("Convention");
		expect(row.proposed_name).toBe("Use strict mode");
		expect(row.proposed_content).toBe("All TypeScript files should use strict mode.");
		expect(row.proposed_tags).toBe('["typescript","strict"]');
		expect(row.proposed_file_paths).toBe('["tsconfig.json"]');
		expect(row.trust_tier).toBe(4);
		expect(row.raw_confidence).toBe(0.85);
		expect(row.validation_status).toBe("pending");
		expect(row.rejection_reason).toBeNull();
		expect(typeof row.created_at).toBe("number");
		expect(typeof row.expires_at).toBe("number");

		// Verify STAGE audit entry was written
		const audit = await db.execute(
			"SELECT operation, entity_id FROM audit_log WHERE entity_id = ? AND operation = 'STAGE'",
			[id],
		);
		expect(audit.rows).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// 2. insertStagedFact sets expires_at = created_at + 7 days
	// ---------------------------------------------------------------

	it("insertStagedFact sets expires_at = created_at + 7 days", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("staging-ttl", tmpDir);

		const id = await insertStagedFact(db, {
			proposed_type: "Concept",
			proposed_name: "TTL test",
			proposed_content: "Testing 7-day TTL.",
			raw_confidence: 0.7,
		});

		const result = await db.execute(
			"SELECT created_at, expires_at FROM memory_staging WHERE id = ?",
			[id],
		);
		const row = result.rows[0] as Record<string, unknown>;
		const createdAt = row.created_at as number;
		const expiresAt = row.expires_at as number;

		const sevenDaysMs = 7 * 86_400_000;
		expect(expiresAt).toBe(createdAt + sevenDaysMs);
	});

	// ---------------------------------------------------------------
	// 3. getPendingStagedFacts returns only pending, non-expired facts
	// ---------------------------------------------------------------

	it("getPendingStagedFacts returns only pending, non-expired facts", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("staging-pending", tmpDir);

		// Insert two pending facts (will have future expires_at by default)
		const id1 = await insertStagedFact(db, {
			proposed_type: "Concept",
			proposed_name: "Pending 1",
			proposed_content: "First pending fact.",
			raw_confidence: 0.8,
		});

		const id2 = await insertStagedFact(db, {
			proposed_type: "Decision",
			proposed_name: "Pending 2",
			proposed_content: "Second pending fact.",
			raw_confidence: 0.9,
		});

		// Insert one and mark it as 'passed' (should be excluded)
		const id3 = await insertStagedFact(db, {
			proposed_type: "Bug",
			proposed_name: "Already passed",
			proposed_content: "This one was already promoted.",
			raw_confidence: 0.95,
		});
		await updateStagingStatus(db, id3, "passed");

		const pending = await getPendingStagedFacts(db);
		expect(pending).toHaveLength(2);

		const pendingIds = pending.map((f) => f.id);
		expect(pendingIds).toContain(id1);
		expect(pendingIds).toContain(id2);
		expect(pendingIds).not.toContain(id3);
	});

	// ---------------------------------------------------------------
	// 4. getPendingStagedFacts excludes expired facts
	// ---------------------------------------------------------------

	it("getPendingStagedFacts excludes expired facts", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("staging-expired-filter", tmpDir);

		// Insert a fact that is already expired (manually set expires_at in the past)
		const expiredId = randomUUID();
		const pastTime = Date.now() - 1_000_000;
		await db.execute(
			`INSERT INTO memory_staging (
				id, proposed_type, proposed_name, proposed_content,
				trust_tier, raw_confidence, validation_status, created_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				expiredId,
				"Concept",
				"Old fact",
				"This expired.",
				4,
				0.8,
				"pending",
				pastTime - 7 * 86_400_000,
				pastTime,
			],
		);

		// Insert a non-expired pending fact
		const freshId = await insertStagedFact(db, {
			proposed_type: "Concept",
			proposed_name: "Fresh fact",
			proposed_content: "This is fresh.",
			raw_confidence: 0.8,
		});

		const pending = await getPendingStagedFacts(db);
		expect(pending).toHaveLength(1);
		expect(pending[0]?.id).toBe(freshId);
	});

	// ---------------------------------------------------------------
	// 5. updateStagingStatus changes status and sets rejection_reason
	// ---------------------------------------------------------------

	it("updateStagingStatus changes status and sets rejection_reason", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("staging-update-status", tmpDir);

		const id = await insertStagedFact(db, {
			proposed_type: "Convention",
			proposed_name: "Suspicious fact",
			proposed_content: "Some suspicious content.",
			raw_confidence: 0.6,
		});

		await updateStagingStatus(db, id, "quarantined", "PATTERN_INJECTION_DETECTED");

		const result = await db.execute(
			"SELECT validation_status, rejection_reason FROM memory_staging WHERE id = ?",
			[id],
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.validation_status).toBe("quarantined");
		expect(result.rows[0]?.rejection_reason).toBe("PATTERN_INJECTION_DETECTED");

		// Verify QUARANTINE audit entry was written
		const audit = await db.execute(
			"SELECT operation, entity_id FROM audit_log WHERE entity_id = ? AND operation = 'QUARANTINE'",
			[id],
		);
		expect(audit.rows).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// 6. expireStaleStagedFacts expires old pending facts
	// ---------------------------------------------------------------

	it("expireStaleStagedFacts expires old pending facts", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("staging-expire-stale", tmpDir);

		// Insert two facts with past expires_at (manually)
		const pastTime = Date.now() - 1_000;
		for (let i = 0; i < 2; i++) {
			await db.execute(
				`INSERT INTO memory_staging (
					id, proposed_type, proposed_name, proposed_content,
					trust_tier, raw_confidence, validation_status, created_at, expires_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					randomUUID(),
					"Concept",
					`Stale fact ${i}`,
					`Content ${i}`,
					4,
					0.7,
					"pending",
					pastTime - 7 * 86_400_000,
					pastTime,
				],
			);
		}

		// Insert one fresh pending fact (should NOT be expired)
		await insertStagedFact(db, {
			proposed_type: "Concept",
			proposed_name: "Fresh fact",
			proposed_content: "Still valid.",
			raw_confidence: 0.8,
		});

		const expiredCount = await expireStaleStagedFacts(db);
		expect(expiredCount).toBe(2);

		// Verify the stale ones are now 'expired'
		const expired = await db.execute(
			"SELECT validation_status FROM memory_staging WHERE validation_status = 'expired'",
		);
		expect(expired.rows).toHaveLength(2);

		// Fresh one is still pending
		const pending = await getPendingStagedFacts(db);
		expect(pending).toHaveLength(1);
		expect(pending[0]?.proposed_name).toBe("Fresh fact");
	});

	// ---------------------------------------------------------------
	// 7. No FK constraint: insert with non-existent source_episode succeeds
	// ---------------------------------------------------------------

	it("insert with non-existent source_episode succeeds (no FK constraint)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("staging-no-fk", tmpDir);

		// source_episode points to a non-existent episode — should NOT throw
		const id = await insertStagedFact(db, {
			source_episode: "episode-that-does-not-exist",
			proposed_type: "Concept",
			proposed_name: "Orphan fact",
			proposed_content: "This references a missing episode.",
			raw_confidence: 0.75,
		});

		const result = await db.execute("SELECT id, source_episode FROM memory_staging WHERE id = ?", [
			id,
		]);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.source_episode).toBe("episode-that-does-not-exist");
	});

	// ---------------------------------------------------------------
	// 8. Tier 4 fact successfully inserted
	// ---------------------------------------------------------------

	it("Tier 4 fact successfully inserted (default trust_tier)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("staging-tier4", tmpDir);

		// Omit trust_tier — should default to 4
		const id = await insertStagedFact(db, {
			proposed_type: "Convention",
			proposed_name: "External convention",
			proposed_content: "Convention from external source.",
			raw_confidence: 0.65,
		});

		const result = await db.execute("SELECT trust_tier FROM memory_staging WHERE id = ?", [id]);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.trust_tier).toBe(4);

		// Also verify audit entry has trust_tier = 4
		const audit = await db.execute(
			"SELECT trust_tier FROM audit_log WHERE entity_id = ? AND operation = 'STAGE'",
			[id],
		);
		expect(audit.rows).toHaveLength(1);
		expect(audit.rows[0]?.trust_tier).toBe(4);
	});
});
