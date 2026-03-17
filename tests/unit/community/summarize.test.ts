import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { detectCommunities } from "@/community/leiden";
import { summarizeCommunities } from "@/community/summarize";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function createDb() {
        const dir = mkdtempSync(join(tmpdir(), "sia-summary-"));
        return openGraphDb("summary-repo", dir);
}

async function seedSmallGraph(db: SiaDb) {
        const ids: string[] = [];
        for (let i = 0; i < 6; i++) {
                const entity = await insertEntity(db, {
                        type: "Function",
                        name: `entity-${i}`,
                        content: `content-${i}`,
                        summary: `summary-${i}`,
                        importance: 0.5 + i * 0.05,
                });
                ids.push(entity.id);
        }
        for (let i = 0; i < ids.length - 1; i++) {
                await insertEdge(db, { from_id: ids[i], to_id: ids[i + 1], type: "calls", weight: 1 });
        }
}

describe("summarizeCommunities", () => {
        it("creates summaries and refreshes when membership changes", async () => {
                const db = createDb();
                await seedSmallGraph(db);
                await detectCommunities(db);

                const generated = await summarizeCommunities(db, { airGapped: false });
                expect(generated).toBeGreaterThan(0);

                const before = await db.execute(
                        "SELECT id, summary, summary_hash, member_count, last_summary_member_count FROM communities LIMIT 1",
                );
                const community = before.rows[0] as {
                        id: string;
                        summary: string | null;
                        summary_hash: string | null;
                        member_count: number;
                        last_summary_member_count: number;
                };
                expect(community.summary).toBeTruthy();
                expect(community.summary_hash).toBeTruthy();
                expect(community.last_summary_member_count).toBe(community.member_count);

                // Add a new member to trigger cache invalidation (>20% change)
                const extraEntity = await insertEntity(db, {
                        type: "Function",
                        name: "extra",
                        content: "extra content",
                        summary: "extra summary",
                });
                await db.execute(
                        "INSERT INTO community_members (community_id, entity_id, level) VALUES (?, ?, 0)",
                        [community.id, extraEntity.id],
                );
                await db.execute("UPDATE communities SET member_count = member_count + 1 WHERE id = ?", [community.id]);

                const regenerated = await summarizeCommunities(db, { airGapped: false });
                expect(regenerated).toBeGreaterThan(0);

                const after = await db.execute(
                        "SELECT member_count, last_summary_member_count FROM communities WHERE id = ?",
                        [community.id],
                );
                const updated = after.rows[0] as { member_count: number; last_summary_member_count: number };
                expect(updated.last_summary_member_count).toBe(updated.member_count);

                // Air-gapped mode should skip updates
                await db.execute("UPDATE communities SET member_count = member_count + 2 WHERE id = ?", [community.id]);
                const beforeAirGapped = await db.execute(
                        "SELECT last_summary_member_count FROM communities WHERE id = ?",
                        [community.id],
                );
                const prevCount = (beforeAirGapped.rows[0] as { last_summary_member_count: number })
                        .last_summary_member_count;
                const skipped = await summarizeCommunities(db, { airGapped: true });
                expect(skipped).toBe(0);
                const afterAirGapped = await db.execute(
                        "SELECT last_summary_member_count FROM communities WHERE id = ?",
                        [community.id],
                );
                expect((afterAirGapped.rows[0] as { last_summary_member_count: number }).last_summary_member_count).toBe(
                        prevCount,
                );

                await db.close();
        });
});
