import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
