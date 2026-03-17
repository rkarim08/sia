// Module: raptor — RAPTOR summary tree construction

import { createHash } from "node:crypto";
import type { SiaDb } from "@/graph/db-interface";

interface EntityRow {
        id: string;
        content: string;
        summary: string;
        t_valid_until: number | null;
}

interface CommunityRow {
        id: string;
        summary: string | null;
}

interface SummaryRow {
        id: string;
        level: number;
        scopeId: string;
        content: string;
        tokenCount: number;
        contentHash: string;
        expiresAt: number | null;
}

function wordCount(text: string): number {
        const trimmed = text.trim();
        if (!trimmed) return 0;
        return trimmed.split(/\s+/).length;
}

function hashContent(content: string): string {
        return createHash("sha256").update(content).digest("hex");
}

async function upsertSummary(db: SiaDb, row: SummaryRow, now: number): Promise<void> {
        await db.execute(
                `INSERT INTO summary_tree (id, level, scope_id, content, content_hash, token_count, created_at, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                        level = excluded.level,
                        scope_id = excluded.scope_id,
                        content = excluded.content,
                        content_hash = excluded.content_hash,
                        token_count = excluded.token_count,
                        created_at = excluded.created_at,
                        expires_at = excluded.expires_at`,
                [row.id, row.level, row.scopeId, row.content, row.contentHash, row.tokenCount, now, row.expiresAt],
        );
}

export async function buildSummaryTree(db: SiaDb): Promise<void> {
        const now = Date.now();

        const entityResult = await db.execute(
                `SELECT id, content, summary, t_valid_until
                 FROM entities`,
        );
        const communityResult = await db.execute(`SELECT id, summary FROM communities`);

        const entities = entityResult.rows as unknown as EntityRow[];
        const communities = communityResult.rows as unknown as CommunityRow[];

        await db.transaction(async (tx) => {
                // Levels 0 & 1 — entities
                for (const entity of entities) {
                        const level0: SummaryRow = {
                                id: `lvl0:${entity.id}`,
                                level: 0,
                                scopeId: entity.id,
                                content: entity.content,
                                tokenCount: wordCount(entity.content),
                                contentHash: hashContent(entity.content),
                                expiresAt: null,
                        };
                        await upsertSummary(tx, level0, now);

                        const summaryText =
                                entity.summary && entity.summary.trim().length > 0
                                        ? entity.summary
                                        : entity.content.slice(0, 240);
                        const level1: SummaryRow = {
                                id: `lvl1:${entity.id}`,
                                level: 1,
                                scopeId: entity.id,
                                content: summaryText,
                                tokenCount: wordCount(summaryText),
                                contentHash: hashContent(summaryText),
                                expiresAt: entity.t_valid_until ? now : null,
                        };
                        await upsertSummary(tx, level1, now);
                }

                // Level 2 — community/module summaries
                for (const community of communities) {
                        const content =
                                community.summary && community.summary.trim().length > 0
                                        ? community.summary
                                        : `Community ${community.id} has no summary.`;
                        const level2: SummaryRow = {
                                id: `lvl2:${community.id}`,
                                level: 2,
                                scopeId: community.id,
                                content,
                                tokenCount: wordCount(content),
                                contentHash: hashContent(content),
                                expiresAt: null,
                        };
                        await upsertSummary(tx, level2, now);
                }

                // Level 3 — architectural overview
                if (communities.length > 0) {
                        const overviewBody = communities
                                .map((c) => {
                                        const text =
                                                c.summary && c.summary.trim().length > 0
                                                        ? c.summary.trim()
                                                        : `Community ${c.id} has no summary.`;
                                        return `- ${text}`;
                                })
                                .join("\n");
                        const overview = `Architectural overview:\n${overviewBody}`;
                        const level3: SummaryRow = {
                                id: "lvl3:overview",
                                level: 3,
                                scopeId: "all",
                                content: overview,
                                tokenCount: wordCount(overview),
                                contentHash: hashContent(overview),
                                expiresAt: null,
                        };
                        await upsertSummary(tx, level3, now);
                }
        });
}
