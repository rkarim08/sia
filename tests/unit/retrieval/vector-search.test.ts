import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { vectorSearch } from "@/retrieval/vector-search";

describe("vectorSearch — dual-column support", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-vs-test-${randomUUID()}`);
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

	/** Build a minimal embedder stub returning a fixed vector. */
	function makeEmbedder(vec: Float32Array) {
		return {
			embed: async (_text: string) => vec,
			embedBatch: async (texts: string[]) => texts.map(() => vec),
			close: () => {},
		};
	}

	/** Serialize Float32Array to BLOB-compatible Buffer. */
	function toBlob(vec: Float32Array): Buffer {
		return Buffer.from(vec.buffer);
	}

	/** Insert a raw entity row with all required NOT NULL columns. */
	async function insertRawEntity(
		siaDb: SiaDb,
		id: string,
		opts: { trustTier?: number; embedding?: Buffer | null; embeddingCode?: Buffer | null },
	): Promise<void> {
		const now = Date.now();
		await siaDb.execute(
			`INSERT INTO graph_nodes
			 (id, type, name, content, summary, trust_tier, confidence, importance,
			  embedding, embedding_code, last_accessed, t_valid_from, t_created, created_at, created_by)
			 VALUES (?, 'Concept', ?, 'test content', 'summary', ?, 0.9, 0.8, ?, ?, ?, ?, ?, ?, 'test')`,
			[
				id,
				`Entity_${id}`,
				opts.trustTier ?? 2,
				opts.embedding ?? null,
				opts.embeddingCode ?? null,
				now,
				now,
				now,
				now,
			],
		);
	}

	it("returns empty when no entities have the embedding column populated", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vs-empty", tmpDir);

		const queryVec = new Float32Array(4).fill(1);
		const embedder = makeEmbedder(queryVec);

		const results = await vectorSearch(db, "test", embedder, { limit: 5 });
		expect(results).toHaveLength(0);
	});

	it("returns results when NL embedding column is populated", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vs-nl", tmpDir);

		const vec = new Float32Array([1, 0, 0, 0]);
		await insertRawEntity(db, "nl-entity-1", { embedding: toBlob(vec) });

		const embedder = makeEmbedder(vec);
		const results = await vectorSearch(db, "test", embedder, {
			limit: 5,
			embeddingColumn: "embedding",
		});

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].entityId).toBe("nl-entity-1");
		expect(results[0].score).toBeCloseTo(1.0, 3);
	});

	it("returns results from embedding_code column when specified", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vs-code", tmpDir);

		const vec = new Float32Array([0, 1, 0, 0]);
		await insertRawEntity(db, "code-entity-1", { embeddingCode: toBlob(vec) });

		const embedder = makeEmbedder(vec);
		const results = await vectorSearch(db, "function", embedder, {
			limit: 5,
			embeddingColumn: "embedding_code",
		});

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].entityId).toBe("code-entity-1");
	});

	it("embedding column defaults to 'embedding' when not specified", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vs-default-col", tmpDir);

		const vec = new Float32Array([1, 0, 0, 0]);
		await insertRawEntity(db, "default-entity-1", { embedding: toBlob(vec) });

		const embedder = makeEmbedder(vec);
		// No embeddingColumn specified — should default to "embedding"
		const results = await vectorSearch(db, "test", embedder, { limit: 5 });

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].entityId).toBe("default-entity-1");
	});

	it("code-column search does not return entities with only NL embedding", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vs-col-isolation", tmpDir);

		const vec = new Float32Array([1, 0, 0, 0]);
		// Only NL embedding — embedding_code stays NULL
		await insertRawEntity(db, "nl-only-1", { embedding: toBlob(vec) });

		const embedder = makeEmbedder(vec);
		// Search code column — should find nothing
		const results = await vectorSearch(db, "test", embedder, {
			limit: 5,
			embeddingColumn: "embedding_code",
		});

		const nlOnlyResult = results.find((r) => r.entityId === "nl-only-1");
		expect(nlOnlyResult).toBeUndefined();
	});

	it("paranoid flag excludes tier-4 entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vs-paranoid", tmpDir);

		const vec = new Float32Array([1, 0, 0, 0]);
		await insertRawEntity(db, "tier4-entity-1", {
			trustTier: 4,
			embedding: toBlob(vec),
		});

		const embedder = makeEmbedder(vec);
		const results = await vectorSearch(db, "test", embedder, {
			limit: 5,
			paranoid: true,
		});

		const tier4 = results.find((r) => r.entityId === "tier4-entity-1");
		expect(tier4).toBeUndefined();
	});

	it("handles mismatched embedding dimensions without crashing", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("vs-mismatch", tmpDir);

		// Store a 4d embedding but query with a 2d vector
		const stored = new Float32Array([1, 0, 0, 0]);
		await insertRawEntity(db, "mismatch-1", { embedding: toBlob(stored) });

		const queryVec = new Float32Array([1, 0]); // Different dimension
		const embedder = makeEmbedder(queryVec);

		// Should throw due to dimension mismatch in cosineSim
		await expect(vectorSearch(db, "test", embedder, { limit: 5 })).rejects.toThrow(
			"dimension mismatch",
		);
	});
});
