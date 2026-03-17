import { describe, expect, it } from "vitest";
import { pushChanges } from "@/sync/push";
import { createTestDb } from "./helpers";

const CONFIG = { enabled: true, serverUrl: "https://srv", developerId: "dev", syncInterval: 30 };

describe("pushChanges", () => {
        it("pushes only non-private unsynced entities and stamps synced_at", async () => {
                const db = await createTestDb();
                await db.execute(
                        "INSERT INTO entities (id, type, name, content, summary, visibility, hlc_modified, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        ["e1", "Concept", "A", "content", "sum", "team", 100, null],
                );
                await db.execute(
                        "INSERT INTO entities (id, type, name, content, summary, visibility, hlc_modified, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        ["e2", "Concept", "B", "content", "sum", "private", 200, null],
                );
                await db.execute(
                        "INSERT INTO entities (id, type, name, content, summary, visibility, hlc_modified, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        ["e3", "Concept", "C", "content", "sum", "team", 50, 80],
                );

                const result = await pushChanges(db, CONFIG);
                expect(result.entitiesPushed).toBe(1);

                const rows = await db.execute("SELECT id, synced_at FROM entities ORDER BY id");
                const e1 = rows.rows.find((r) => (r as { id: string }).id === "e1") as { synced_at: number | null };
                const e2 = rows.rows.find((r) => (r as { id: string }).id === "e2") as { synced_at: number | null };
                expect(e1.synced_at).not.toBeNull();
                expect(e2.synced_at).toBeNull();
        });
});
