import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { detectCommunities } from "@/community/leiden";
import { shouldRunDetection } from "@/community/scheduler";
import type { SiaConfig } from "@/shared/config";
import { DEFAULT_CONFIG } from "@/shared/config";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function createDb() {
        const dir = mkdtempSync(join(tmpdir(), "sia-scheduler-"));
        return openGraphDb("scheduler-repo", dir);
}

async function seedEntities(db: SiaDb, count: number) {
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
                const entity = await insertEntity(db, {
                        type: "Function",
                        name: `entity-${i}`,
                        content: `content-${i}`,
                        summary: `summary-${i}`,
                });
                ids.push(entity.id);
        }
        for (let i = 0; i < ids.length - 1; i++) {
                await insertEdge(db, { from_id: ids[i], to_id: ids[i + 1], type: "calls", weight: 1 });
        }
}

describe("shouldRunDetection", () => {
        it("returns false when graph is below minimum size", async () => {
                const db = createDb();
                await seedEntities(db, 50);
                const config: SiaConfig = { ...DEFAULT_CONFIG };
                const result = await shouldRunDetection(db, config);
                expect(result).toBe(false);
                await db.close();
        });

        it("fires when new entities exceed threshold and size is sufficient", async () => {
                const db = createDb();
                await seedEntities(db, 120);
                const config: SiaConfig = { ...DEFAULT_CONFIG };
                const shouldRun = await shouldRunDetection(db, config);
                expect(shouldRun).toBe(true);

                await detectCommunities(db);
                const afterRun = await shouldRunDetection(db, config);
                expect(afterRun).toBe(false);
                await db.close();
        }, 20000);
});
