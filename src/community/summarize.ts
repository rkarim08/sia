// Module: summarize — community summary generation and caching

import { createHash } from "node:crypto";
import type { SiaDb } from "@/graph/db-interface";

interface CommunityRow {
        id: string;
        member_count: number;
        last_summary_member_count: number;
        summary: string | null;
}

interface TopEntityRow {
        id: string;
        name: string;
        summary: string;
        importance: number;
}

function sha256(value: string): string {
        return createHash("sha256").update(value).digest("hex");
}

function formatSummary(entities: TopEntityRow[]): string {
        if (entities.length === 0) {
                return "Community has no active members.";
        }
        const parts = entities.map((e) => `${e.name}: ${e.summary || "No summary available."}`);
        return `Top members — ${parts.join("; ")}`;
}

async function loadCommunities(db: SiaDb): Promise<CommunityRow[]> {
        const result = await db.execute(
                `SELECT id, member_count, last_summary_member_count, summary
                 FROM communities`,
        );
        return result.rows as unknown as CommunityRow[];
}

async function topEntities(db: SiaDb, communityId: string): Promise<TopEntityRow[]> {
        const result = await db.execute(
                `SELECT e.id, e.name, e.summary, e.importance
                 FROM community_members cm
                 JOIN entities e ON cm.entity_id = e.id
                 WHERE cm.community_id = ?
                   AND e.t_valid_until IS NULL
                   AND e.archived_at IS NULL
                 ORDER BY e.importance DESC
                 LIMIT 5`,
                [communityId],
        );
        return result.rows as unknown as TopEntityRow[];
}

async function memberIds(db: SiaDb, communityId: string): Promise<string[]> {
        const result = await db.execute(
                `SELECT entity_id
                 FROM community_members
                 WHERE community_id = ?
                 ORDER BY entity_id`,
                [communityId],
        );
        return (result.rows as Array<{ entity_id: string }>).map((r) => r.entity_id);
}

export async function summarizeCommunities(
        db: SiaDb,
        config: { airGapped: boolean },
): Promise<number> {
        if (config.airGapped) {
                return 0;
        }

        const communities = await loadCommunities(db);
        let generated = 0;
        const now = Date.now();

        await db.transaction(async (tx) => {
                for (const community of communities) {
                        const changeRatio =
                                Math.abs(community.member_count - community.last_summary_member_count) /
                                Math.max(community.last_summary_member_count, 1);
                        const needsSummary = !community.summary || changeRatio > 0.2;
                        if (!needsSummary) continue;

                        const entities = await topEntities(tx, community.id);
                        const summary = formatSummary(entities);
                        const ids = await memberIds(tx, community.id);
                        const summaryHash = sha256(ids.join(","));

                        await tx.execute(
                                `UPDATE communities
                                 SET summary = ?, summary_hash = ?, last_summary_member_count = ?, updated_at = ?
                                 WHERE id = ?`,
                                [summary, summaryHash, community.member_count, now, community.id],
                        );
                        generated++;
                }
        });

        return generated;
}

export type { TopEntityRow };
