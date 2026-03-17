import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { hlcFromDb, hlcNow, hlcReceive, loadHlc, persistHlc, type HLC } from "@/sync/hlc";

function createClock(): HLC {
        return { wallMs: Date.now(), counter: 0, nodeId: "node-1" };
}

describe("hlc", () => {
        it("increments monotonically within a process", () => {
                const clock = createClock();
                const first = hlcNow(clock);
                const second = hlcNow(clock);
                expect(second > first).toBe(true);
        });

        it("persists and reloads across restarts", () => {
                const dir = mkdtempSync(join(tmpdir(), "hlc-test-"));
                const path = join(dir, "hlc.json");
                const clock = createClock();
                const value = hlcNow(clock);
                persistHlc(clock, path);

                const restored = loadHlc(path, "node-1");
                const restoredValue = hlcNow(restored);
                expect(restored.nodeId).toBe("node-1");
                expect(restoredValue >= value).toBe(true);
        });

        it("handles null from DB", () => {
                expect(hlcFromDb(null)).toBe(0n);
        });

        it("merges remote clock", () => {
                const local = createClock();
                const remoteClock: HLC = { wallMs: local.wallMs, counter: 5, nodeId: "remote" };
                const remoteValue = hlcNow(remoteClock);
                hlcReceive(local, remoteValue);
                expect(local.wallMs).toBeGreaterThanOrEqual(remoteClock.wallMs);
                expect(local.counter).toBeGreaterThan(0);
        });
});
