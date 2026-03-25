import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { applyContextMode, contentTypeChunker, lineChunker } from "@/sandbox/context-mode";

function makeMockEmbedder(): Embedder {
	let callCount = 0;
	const embedFn = vi.fn(async () => {
		callCount++;
		const arr = new Float32Array(384);
		arr[0] = callCount * 0.1;
		return arr;
	});
	return {
		embed: embedFn,
		embedBatch: vi.fn(async (texts: string[]) => {
			const results: (Float32Array | null)[] = [];
			for (const _t of texts) {
				results.push(await embedFn());
			}
			return results;
		}),
		close: vi.fn(),
	};
}

describe("lineChunker", () => {
	it("groups lines into ~512-token chunks", () => {
		const content = Array(100).fill("This is a line of text.").join("\n");
		const chunks = lineChunker.chunk(content);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.text.length).toBeGreaterThan(0);
		}
	});

	it("returns single chunk for small content", () => {
		const chunks = lineChunker.chunk("Hello world");
		expect(chunks.length).toBe(1);
		expect(chunks[0].text).toBe("Hello world");
	});
});

describe("contentTypeChunker", () => {
	it("detects valid JSON and delegates to lineChunker", () => {
		const json = JSON.stringify({ key: "value", nested: { a: 1 } });
		const chunks = contentTypeChunker.chunk(json);
		expect(chunks.length).toBeGreaterThanOrEqual(1);
		expect(chunks[0].text).toContain("key");
	});

	it("falls through on invalid JSON to heading/line detection", () => {
		const content = "{ broken json\n# Heading\nSome text";
		const chunks = contentTypeChunker.chunk(content);
		// Should detect the heading and use headingChunker
		expect(chunks.length).toBeGreaterThanOrEqual(1);
	});

	it("detects markdown headings and delegates to headingChunker", () => {
		const md = "# Title\nParagraph\n## Section\nMore text";
		const chunks = contentTypeChunker.chunk(md);
		expect(chunks.length).toBe(2);
	});

	it("falls back to lineChunker for plain text", () => {
		const text = "Just plain text\nwith no headings\nand no JSON";
		const chunks = contentTypeChunker.chunk(text);
		expect(chunks.length).toBe(1);
		expect(chunks[0].text).toContain("plain text");
	});
});

describe("applyContextMode", () => {
	let tmpDir: string;
	let db: SiaDb;

	afterEach(async () => {
		if (db) await db.close();
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	function setup() {
		tmpDir = mkdtempSync(join(tmpdir(), "sia-ctx-test-"));
		db = openGraphDb(randomUUID(), tmpDir);
	}

	it("returns raw output when below threshold", async () => {
		setup();
		const result = await applyContextMode(
			"small output",
			"find errors",
			lineChunker,
			db,
			makeMockEmbedder(),
			"session-1",
			{ threshold: 10_240, topK: 5 },
		);
		expect(result.applied).toBe(false);
		expect(result.chunks).toEqual(["small output"]);
		expect(result.totalIndexed).toBe(0);
	});

	it("returns raw output when no intent provided", async () => {
		setup();
		const bigOutput = "x".repeat(20_000);
		const result = await applyContextMode(
			bigOutput,
			undefined,
			lineChunker,
			db,
			makeMockEmbedder(),
			"session-1",
			{ threshold: 10_240, topK: 5 },
		);
		expect(result.applied).toBe(false);
	});

	it("applies context mode for large output with intent", async () => {
		setup();
		const lines = Array(500)
			.fill(null)
			.map((_, i) => `Log line ${i}: ${i % 10 === 0 ? "ERROR OOM at line" : "normal operation"}`)
			.join("\n");
		const result = await applyContextMode(
			lines,
			"OOM errors",
			lineChunker,
			db,
			makeMockEmbedder(),
			"session-1",
			{ threshold: 1024, topK: 3 },
		);
		expect(result.applied).toBe(true);
		expect(result.chunks.length).toBeLessThanOrEqual(3);
		expect(result.totalIndexed).toBeGreaterThan(0);
		expect(result.contextSavings).toBeGreaterThan(0);
	});
});
