import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hlcFromDb, hlcNow, hlcReceive, loadHlc, pack, persistHlc, unpack } from "@/sync/hlc";

let tmpDir: string | undefined;

afterEach(() => {
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = undefined;
	}
});

describe("hlc", () => {
	it("hlcNow returns monotonically increasing bigint", () => {
		const first = hlcNow(pack(Date.now(), 0));
		const second = hlcNow(first);
		expect(typeof first).toBe("bigint");
		expect(typeof second).toBe("bigint");
		expect(second > first).toBe(true);
	});

	it("hlcReceive merges local and remote", () => {
		const local = pack(Date.now(), 3);
		const remote = pack(Date.now() + 1000, 5);
		const merged = hlcReceive(local, remote);
		expect(typeof merged).toBe("bigint");
		expect(merged > local).toBe(true);
		expect(merged > remote).toBe(true);
	});

	it("persistHlc + loadHlc round-trip", () => {
		tmpDir = mkdtempSync(join(tmpdir(), "hlc-test-"));
		const repoHash = "test-repo-abc";
		const hlc = pack(1700000000000, 42);

		persistHlc(repoHash, hlc, tmpDir);
		const loaded = loadHlc(repoHash, tmpDir);
		expect(loaded).toBe(hlc);
	});

	it("loadHlc returns fresh clock for missing file", () => {
		tmpDir = mkdtempSync(join(tmpdir(), "hlc-test-"));
		const result = loadHlc("nonexistent-repo", tmpDir);
		expect(typeof result).toBe("bigint");
		expect(result > 0n).toBe(true);
	});

	it("hlcFromDb handles null, number, string, bigint", () => {
		expect(hlcFromDb(null)).toBe(0n);
		expect(hlcFromDb(undefined)).toBe(0n);
		expect(hlcFromDb(12345)).toBe(12345n);
		expect(hlcFromDb("99999")).toBe(99999n);
		expect(hlcFromDb(42n)).toBe(42n);
	});

	it("hlcNow with counter at MAX_COUNTER advances wall clock and resets counter", () => {
		const MAX_COUNTER = 0xffff;
		const wallMs = Date.now() + 10000; // future wall clock so now < wallMs
		const local = pack(wallMs, MAX_COUNTER);
		const result = hlcNow(local);
		const { wallMs: resultWall, counter: resultCounter } = unpack(result);
		expect(resultCounter).toBeLessThanOrEqual(MAX_COUNTER);
		expect(resultWall).toBeGreaterThan(wallMs);
	});

	it("hlcReceive with both clocks at same wallMs near MAX_COUNTER stays within bounds", () => {
		const MAX_COUNTER = 0xffff;
		const wallMs = Date.now() + 10000; // future so now < wallMs
		const local = pack(wallMs, MAX_COUNTER - 1);
		const remote = pack(wallMs, MAX_COUNTER);
		const result = hlcReceive(local, remote);
		const { wallMs: resultWall, counter: resultCounter } = unpack(result);
		// newCounter would be MAX_COUNTER + 1, so wall must advance and counter reset to 0
		expect(resultCounter).toBe(0);
		expect(resultWall).toBeGreaterThan(wallMs);
	});
});
