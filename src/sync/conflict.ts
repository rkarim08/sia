// Module: conflict — conflict detection for concurrent facts

import { v4 as uuid } from "uuid";
import { wordJaccard } from "@/capture/consolidate";
import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";

function rangesOverlap(aStart: number | null, aEnd: number | null, bStart: number | null, bEnd: number | null): boolean {
        const a0 = aStart ?? Number.MIN_SAFE_INTEGER;
        const a1 = aEnd ?? Number.MAX_SAFE_INTEGER;
        const b0 = bStart ?? Number.MIN_SAFE_INTEGER;
        const b1 = bEnd ?? Number.MAX_SAFE_INTEGER;
        return a0 <= b1 && b0 <= a1;
}

export async function detectConflicts(db: SiaDb): Promise<number> {
        const result = await db.execute(
                "SELECT * FROM entities WHERE archived_at IS NULL AND t_valid_until IS NULL",
        );
        const entities = result.rows as Entity[];

        let conflicts = 0;

        for (let i = 0; i < entities.length; i++) {
                for (let j = i + 1; j < entities.length; j++) {
                        const a = entities[i];
                        const b = entities[j];

                        if (a.type !== b.type) continue;
                        if (!rangesOverlap(a.t_valid_from, a.t_valid_until, b.t_valid_from, b.t_valid_until)) continue;

                        const similarity = wordJaccard(a.content, b.content);
                        const contradictory = a.content !== b.content;

                        if (similarity > 0.85 && contradictory) {
                                const groupId = a.conflict_group_id ?? b.conflict_group_id ?? uuid();
                                if (a.conflict_group_id !== groupId) {
                                        await db.execute("UPDATE entities SET conflict_group_id = ? WHERE id = ?", [groupId, a.id]);
                                }
                                if (b.conflict_group_id !== groupId) {
                                        await db.execute("UPDATE entities SET conflict_group_id = ? WHERE id = ?", [groupId, b.id]);
                                }
                                conflicts++;
                        }
                }
        }

        return conflicts;
}
