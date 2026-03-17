import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chunkPayload } from "@/capture/chunker";
import type { HookPayload } from "@/capture/types";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { DEFAULT_CONFIG, type SiaConfig } from "@/shared/config";

/** Minimal config with paranoidCapture off. */
const BASE_CONFIG: SiaConfig = { ...DEFAULT_CONFIG, paranoidCapture: false };

/** Minimal config with paranoidCapture on. */
const PARANOID_CONFIG: SiaConfig = { ...DEFAULT_CONFIG, paranoidCapture: true };

/** Helper to build a HookPayload with sensible defaults. */
function makePayload(overrides: Partial<HookPayload> = {}): HookPayload {
	return {
		cwd: "/project",
		type: "PostToolUse",
		sessionId: "sess-1",
		content: "This is some meaningful content that is long enough to pass filters",
		...overrides,
	};
}

describe("capture/chunker — chunkPayload", () => {
	let tmpDir: string | undefined;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-chunker-test-${randomUUID()}`);
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
			tmpDir = undefined;
		}
	});

	// ---------------------------------------------------------------
	// Filtering: empty content
	// ---------------------------------------------------------------

	it("filters empty content", async () => {
		const result = await chunkPayload(makePayload({ content: "" }), BASE_CONFIG);
		expect(result).toEqual([]);
	});

	it("filters whitespace-only content", async () => {
		const result = await chunkPayload(makePayload({ content: "   \n\t  " }), BASE_CONFIG);
		expect(result).toEqual([]);
	});

	// ---------------------------------------------------------------
	// Filtering: node_modules reads
	// ---------------------------------------------------------------

	it("filters node_modules reads", async () => {
		const result = await chunkPayload(
			makePayload({
				toolName: "Read",
				filePath: "/project/node_modules/foo/index.js",
				content: "module.exports = function() { return 42; }",
			}),
			BASE_CONFIG,
		);
		expect(result).toEqual([]);
	});

	it("filters toolName containing Read with node_modules path", async () => {
		const result = await chunkPayload(
			makePayload({
				toolName: "FileRead",
				filePath: "/project/node_modules/bar/lib.js",
				content: "module.exports = function() { return 42; }",
			}),
			BASE_CONFIG,
		);
		expect(result).toEqual([]);
	});

	it("does NOT filter non-Read tool with node_modules path", async () => {
		const result = await chunkPayload(
			makePayload({
				toolName: "Write",
				filePath: "/project/node_modules/bar/lib.js",
				content: "module.exports = function() { return 42; }",
			}),
			BASE_CONFIG,
		);
		expect(result).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// Filtering: short content (<20 chars)
	// ---------------------------------------------------------------

	it("filters short content (<20 chars)", async () => {
		const result = await chunkPayload(makePayload({ content: "short" }), BASE_CONFIG);
		expect(result).toEqual([]);
	});

	it("filters content that is exactly 19 characters", async () => {
		const result = await chunkPayload(makePayload({ content: "1234567890123456789" }), BASE_CONFIG);
		expect(result).toEqual([]);
	});

	it("accepts content that is exactly 20 characters", async () => {
		const result = await chunkPayload(
			makePayload({ content: "12345678901234567890" }),
			BASE_CONFIG,
		);
		expect(result).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// Tier 1: Stop payloads
	// ---------------------------------------------------------------

	it("assigns Tier 1 to Stop payloads", async () => {
		const result = await chunkPayload(
			makePayload({
				type: "Stop",
				content: "Session ended with a meaningful summary of work done",
			}),
			BASE_CONFIG,
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.trust_tier).toBe(1);
	});

	// ---------------------------------------------------------------
	// Tier 2: tool output with filePath (recognised extension)
	// ---------------------------------------------------------------

	it("assigns Tier 2 to tool output with filePath", async () => {
		const result = await chunkPayload(
			makePayload({
				filePath: "src/utils/helper.ts",
				content: "export function helper() { return true; }",
			}),
			BASE_CONFIG,
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.trust_tier).toBe(2);
		expect(result[0]?.file_paths).toEqual(["src/utils/helper.ts"]);
	});

	// ---------------------------------------------------------------
	// Tier 3: tool output without filePath
	// ---------------------------------------------------------------

	it("assigns Tier 3 to tool output without filePath", async () => {
		const result = await chunkPayload(
			makePayload({
				content: "The function processes input and returns formatted output",
			}),
			BASE_CONFIG,
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.trust_tier).toBe(3);
		expect(result[0]?.file_paths).toEqual([]);
	});

	// ---------------------------------------------------------------
	// Tier 4: content with external URLs
	// ---------------------------------------------------------------

	it("assigns Tier 4 to content with external URLs", async () => {
		const result = await chunkPayload(
			makePayload({
				content: "Fetched data from https://api.example.com/data and processed it locally",
				filePath: "src/api.ts",
			}),
			BASE_CONFIG,
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.trust_tier).toBe(4);
	});

	it("does NOT assign Tier 4 for localhost URLs", async () => {
		const result = await chunkPayload(
			makePayload({
				content: "Connected to http://localhost:3000/api/health for the check",
				filePath: "src/health.ts",
			}),
			BASE_CONFIG,
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.trust_tier).toBe(2);
	});

	// ---------------------------------------------------------------
	// paranoidCapture quarantines Tier 4
	// ---------------------------------------------------------------

	it("paranoidCapture quarantines Tier 4 (writes audit log)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("chunker-paranoid", tmpDir);

		const result = await chunkPayload(
			makePayload({
				content: "Fetched data from https://external.example.com/secrets and processed it",
				filePath: "src/fetch.ts",
			}),
			PARANOID_CONFIG,
			db,
		);

		// Should be discarded
		expect(result).toEqual([]);

		// Audit log should contain QUARANTINE entry
		const rows = await db.execute(
			"SELECT operation, trust_tier, source_episode FROM audit_log WHERE operation = 'QUARANTINE'",
		);
		expect(rows.rows).toHaveLength(1);
		expect(rows.rows[0]?.trust_tier).toBe(4);
		expect(rows.rows[0]?.source_episode).toBe("sess-1");
	});

	it("paranoidCapture quarantines Tier 4 without db (no error)", async () => {
		const result = await chunkPayload(
			makePayload({
				content: "Fetched data from https://external.example.com/secrets and processed it",
				filePath: "src/fetch.ts",
			}),
			PARANOID_CONFIG,
		);
		expect(result).toEqual([]);
	});

	// ---------------------------------------------------------------
	// paranoidCapture does NOT affect Tier 1-3
	// ---------------------------------------------------------------

	it("paranoidCapture does NOT affect Tier 1 (Stop)", async () => {
		const result = await chunkPayload(
			makePayload({ type: "Stop", content: "Session ended with a meaningful summary of work" }),
			PARANOID_CONFIG,
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.trust_tier).toBe(1);
	});

	it("paranoidCapture does NOT affect Tier 2 (filePath)", async () => {
		const result = await chunkPayload(
			makePayload({
				filePath: "src/index.ts",
				content: "export function main() { console.log('hello'); }",
			}),
			PARANOID_CONFIG,
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.trust_tier).toBe(2);
	});

	it("paranoidCapture does NOT affect Tier 3 (no filePath)", async () => {
		const result = await chunkPayload(
			makePayload({
				content: "The function processes input and returns formatted output nicely",
			}),
			PARANOID_CONFIG,
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.trust_tier).toBe(3);
	});

	// ---------------------------------------------------------------
	// Name and summary extraction
	// ---------------------------------------------------------------

	it("extracts name as first 50 chars of content", async () => {
		const longContent = `${"A".repeat(60)} some more content padding to make it long enough`;
		const result = await chunkPayload(makePayload({ content: longContent }), BASE_CONFIG);
		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe("A".repeat(50));
	});

	it("extracts summary as first 100 chars of content", async () => {
		const longContent = "B".repeat(120);
		const result = await chunkPayload(makePayload({ content: longContent }), BASE_CONFIG);
		expect(result).toHaveLength(1);
		expect(result[0]?.summary).toBe("B".repeat(100));
	});
});
