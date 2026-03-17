import { describe, expect, it } from "vitest";
import { detectConflicts } from "@/sync/conflict";
import { createTestDb } from "./helpers";

describe("detectConflicts", () => {
        it("flags overlapping similar entities with conflict_group_id", async () => {
                const db = await createTestDb();
                await db.execute(
                        "INSERT INTO entities (id, type, name, content, summary, visibility, t_valid_from, t_valid_until, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        ["e1", "Concept", "A", "alpha beta gamma", "s", "team", null, null, null],
                );
                await db.execute(
                        "INSERT INTO entities (id, type, name, content, summary, visibility, t_valid_from, t_valid_until, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        ["e2", "Concept", "A", "alpha beta gamma alpha", "s", "team", null, null, null],
                );
                await db.execute(
                        "INSERT INTO entities (id, type, name, content, summary, visibility, t_valid_from, t_valid_until, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        ["e3", "Decision", "B", "different", "s", "team", null, null, null],
                );

                const count = await detectConflicts(db);
                expect(count).toBe(1);

                const rows = await db.execute("SELECT conflict_group_id FROM entities WHERE id IN ('e1','e2')");
                for (const row of rows.rows as Array<{ conflict_group_id: string | null }>) {
                        expect(row.conflict_group_id).not.toBeNull();
                }
        });
});
