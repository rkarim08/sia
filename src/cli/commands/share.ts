// Module: share — adjust entity visibility for sharing

import type { SiaDb } from "@/graph/db-interface";
import { updateEntity } from "@/graph/entities";

export async function shareEntity(
        db: SiaDb,
        entityId: string,
        opts: { team?: boolean; project?: string | null } = {},
): Promise<void> {
        const visibility = opts.team ? "team" : opts.project ? "project" : "private";
        await updateEntity(db, entityId, {
                visibility,
                workspace_scope: opts.project ?? null,
        });
}
