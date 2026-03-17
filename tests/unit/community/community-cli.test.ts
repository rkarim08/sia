import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { formatCommunityTree } from "@/cli/commands/community";
import { detectCommunities } from "@/community/leiden";
import { summarizeCommunities } from "@/community/summarize";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function createDb() {
        const dir = mkdtempSync(join(tmpdir(), "sia-cli-"));
        return openGraphDb("cli-repo", dir);
}

async function seedGraph(db: SiaDb) {
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
                const entity = await insertEntity(db, {
                        type: "Function",
                        name: `cli-entity-${i}`,
                        content: `content-${i}`,
                        summary: `summary-${i}`,
                });
                ids.push(entity.id);
        }
        for (let i = 0; i < ids.length - 1; i++) {
                await insertEdge(db, { from_id: ids[i], to_id: ids[i + 1], type: "calls", weight: 1 });
        }
}

describe("community CLI formatter", () => {
        it("renders a human-readable tree with entities", async () => {
                const db = createDb();
                await seedGraph(db);
                await detectCommunities(db);
                await summarizeCommunities(db, { airGapped: false });

                const output = await formatCommunityTree(db);
                expect(output).toContain("Community");
                expect(output).toMatch(/- cli-entity-/);

                await db.close();
        });
});
