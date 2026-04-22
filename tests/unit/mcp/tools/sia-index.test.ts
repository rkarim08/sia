import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaIndex } from "@/mcp/tools/sia-index";
import { headingChunker } from "@/sandbox/context-mode";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

const mockEmbedder = {
	embed: vi.fn(async () => new Float32Array(384)),
	embedBatch: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array(384))),
	close: vi.fn(),
};

describe("headingChunker", () => {
	it("splits markdown by headings into chunks", () => {
		const md = "# Intro\nText\n## Details\nText\n## Conclusion\nFinal";
		const chunks = headingChunker.chunk(md);
		expect(chunks).toHaveLength(3);
		expect(chunks[0].metadata?.heading).toBe("# Intro");
		expect(chunks[1].metadata?.heading).toBe("## Details");
		expect(chunks[2].metadata?.heading).toBe("## Conclusion");
	});

	it("keeps code blocks intact — heading-like line inside fence does not split", () => {
		const md = "# Real Heading\nSome text\n```\n# Not a heading\n```\nMore text";
		const chunks = headingChunker.chunk(md);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].text).toContain("# Not a heading");
	});

	it("returns single chunk when no headings found", () => {
		const md = "Just plain text\nwith no headings";
		const chunks = headingChunker.chunk(md);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].text).toBe(md);
	});
});

describe("handleSiaIndex", () => {
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

	it("indexes markdown content into ContentChunk nodes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sia-index-chunks", tmpDir);

		const content = "# Section One\nContent here\n## Section Two\nMore content";
		const result = await handleSiaIndex(
			db,
			{ content, source: "test.md" },
			mockEmbedder,
			"session-abc",
		);

		expect(result.indexed).toBe(2);
		expect(result.chunkIds).toHaveLength(2);
		expect(result.references).toBeGreaterThanOrEqual(0);

		// Verify nodes were written to graph_nodes
		const { rows } = await db.execute(
			"SELECT id, type FROM graph_nodes WHERE type = 'ContentChunk'",
			[],
		);
		expect(rows).toHaveLength(2);
	});

	it("executes with null embedder", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sia-index-null-emb", tmpDir);

		// sia_index accepts _embedder but never uses it
		// This test verifies it doesn't crash when embedder is null
		const result = await handleSiaIndex(
			db,
			{ content: "# Test\nSome test content", source: "test-doc" },
			null,
			"session-null-emb",
		);

		expect(result).toBeDefined();
		expect(result.indexed).toBeGreaterThanOrEqual(0);
	});

	it("returns 0 for empty content", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("sia-index-empty", tmpDir);

		const result = await handleSiaIndex(db, { content: "" }, mockEmbedder, "session-xyz");

		expect(result.indexed).toBe(0);
		expect(result.references).toBe(0);
		expect(result.chunkIds).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// next_steps populated when chunks indexed
	// ---------------------------------------------------------------

	it("populates next_steps when chunks indexed", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("index-next-steps", tmpDir);

		const result = await handleSiaIndex(
			db,
			{ content: "# Heading\nSome content to index here.", source: "test.md" },
			mockEmbedder,
			"sess-next",
		);
		expect(result.indexed).toBeGreaterThan(0);
		expect(result.next_steps?.length).toBeGreaterThan(0);
		expect(result.next_steps?.map((s) => s.tool)).toContain("sia_search");
	});
});
