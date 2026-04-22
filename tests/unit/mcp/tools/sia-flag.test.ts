import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaFlag, sanitizeReason } from "@/mcp/tools/sia-flag";

describe("sia_flag tool", () => {
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
	// Returns error when flagging disabled
	// ---------------------------------------------------------------

	it("returns error when flagging is disabled", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("flag-disabled", tmpDir);

		const result = await handleSiaFlag(
			db,
			{ reason: "something wrong" },
			{ enableFlagging: false, sessionId: "sess-1" },
		);

		expect(result.error).toBe("Flagging is disabled. Run 'npx sia enable-flagging' to enable.");
		expect(result.flagged).toBeUndefined();
	});

	// ---------------------------------------------------------------
	// Sanitizes injection characters
	// ---------------------------------------------------------------

	it("sanitizes injection characters", () => {
		const input = 'Some <script>alert("xss")</script> reason [with] {brackets}';
		const result = sanitizeReason(input);
		expect(result).not.toContain("<");
		expect(result).not.toContain(">");
		expect(result).not.toContain("{");
		expect(result).not.toContain("}");
		expect(result).not.toContain("[");
		expect(result).not.toContain("]");
		expect(result).not.toContain('"');
		expect(result).toContain("Some");
		expect(result).toContain("reason");
	});

	// ---------------------------------------------------------------
	// Truncates to 100 chars
	// ---------------------------------------------------------------

	it("truncates to 100 chars", () => {
		const longReason = "a".repeat(200);
		const result = sanitizeReason(longReason);
		expect(result).toHaveLength(100);
	});

	// ---------------------------------------------------------------
	// Empty after sanitization returns error
	// ---------------------------------------------------------------

	it("empty after sanitization returns error", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("flag-empty", tmpDir);

		const result = await handleSiaFlag(
			db,
			{ reason: '<>{}[]\\""' },
			{ enableFlagging: true, sessionId: "sess-2" },
		);

		expect(result.error).toBe("Flag reason is empty after sanitization");
		expect(result.flagged).toBeUndefined();
	});

	// ---------------------------------------------------------------
	// Successful flag returns { flagged: true, id }
	// ---------------------------------------------------------------

	it("successful flag returns flagged true and id", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("flag-success", tmpDir);

		const result = await handleSiaFlag(
			db,
			{ reason: "Model hallucinated a function name" },
			{ enableFlagging: true, sessionId: "sess-3" },
		);

		expect(result.flagged).toBe(true);
		expect(result.id).toBeDefined();
		expect(result.error).toBeUndefined();

		// Verify row was actually inserted
		const rows = await db.execute("SELECT * FROM session_flags WHERE id = ?", [result.id]);
		expect(rows.rows).toHaveLength(1);
		expect(rows.rows[0].session_id).toBe("sess-3");
		expect(rows.rows[0].reason).toBe("Model hallucinated a function name");
		expect(rows.rows[0].consumed).toBe(0);
	});

	// ---------------------------------------------------------------
	// Preserves colons, backticks, slashes
	// ---------------------------------------------------------------

	// ---------------------------------------------------------------
	// Mirrors the flag into graph_nodes and embeds it
	// ---------------------------------------------------------------

	it("embeds the flag entity when an embedder is provided", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("flag-embed", tmpDir);

		const mockEmbedding = new Float32Array(384).fill(0.1);
		const mockEmbedder: Embedder = {
			embed: vi.fn().mockResolvedValue(mockEmbedding),
			embedBatch: vi.fn().mockResolvedValue([]),
			close: vi.fn(),
		};

		const result = await handleSiaFlag(
			db,
			{ reason: "Flag with embedding check" },
			{ enableFlagging: true, sessionId: "sess-embed" },
			mockEmbedder,
		);

		expect(result.flagged).toBe(true);
		expect(result.id).toBeDefined();

		// The embedder should have been invoked once with the flag text.
		expect(mockEmbedder.embed).toHaveBeenCalledTimes(1);

		// A mirror SessionFlag node should exist in graph_nodes with a non-null embedding.
		const nodeRows = await db.execute(
			"SELECT id, type, kind, name, content, embedding FROM graph_nodes WHERE id = ?",
			[result.id],
		);
		expect(nodeRows.rows).toHaveLength(1);
		const node = nodeRows.rows[0] as Record<string, unknown>;
		expect(node.type).toBe("SessionFlag");
		expect(node.kind).toBe("SessionFlag");
		expect(node.content).toBe("Flag with embedding check");
		expect(node.embedding).not.toBeNull();
		expect(node.embedding).toBeDefined();

		// Ensure the stored blob carries real data (not a zero-byte buffer).
		const blob = node.embedding as Uint8Array;
		expect(blob.byteLength).toBe(mockEmbedding.byteLength);
	});

	// ---------------------------------------------------------------
	// Embedder absent: flag still succeeds, entity stored without embedding
	// ---------------------------------------------------------------

	it("skips embedding when no embedder is provided", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("flag-no-embed", tmpDir);

		const result = await handleSiaFlag(
			db,
			{ reason: "No embedder available" },
			{ enableFlagging: true, sessionId: "sess-no-embed" },
		);

		expect(result.flagged).toBe(true);
		expect(result.id).toBeDefined();

		const nodeRows = await db.execute("SELECT embedding FROM graph_nodes WHERE id = ?", [
			result.id,
		]);
		expect(nodeRows.rows).toHaveLength(1);
		expect((nodeRows.rows[0] as Record<string, unknown>).embedding).toBeNull();
	});

	it("preserves colons, backticks, slashes", () => {
		const input = "Error in `foo`: path/to/file @ line#42 (see note), it's a bug - really.";
		const result = sanitizeReason(input);
		expect(result).toContain(":");
		expect(result).toContain("`");
		expect(result).toContain("/");
		expect(result).toContain("@");
		expect(result).toContain("#");
		expect(result).toContain("(");
		expect(result).toContain(")");
		expect(result).toContain(",");
		expect(result).toContain("'");
		expect(result).toContain("-");
		expect(result).toContain(".");
		expect(result).toBe(input);
	});
});
