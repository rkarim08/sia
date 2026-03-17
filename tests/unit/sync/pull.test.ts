import { describe, expect, it } from "vitest";
import { pullChanges } from "@/sync/pull";
import { createTestDb } from "./helpers";

const CONFIG = { enabled: true, serverUrl: "https://srv", developerId: "dev", syncInterval: 30 };

describe("pullChanges", () => {
	it("refreshes VSS for entities with embeddings and counts received entities", async () => {
		const db = await createTestDb();
		const bridgeDb = await createTestDb();
		const embedding = new Uint8Array(new Float32Array([1, 0, 0, 0]).buffer);
		await db.execute(
			"INSERT INTO entities (id, type, name, content, summary, visibility, hlc_modified, synced_at, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			["e1", "Concept", "Name", "content", "sum", "team", 200, 100, embedding],
		);

		const result = await pullChanges(db, bridgeDb, CONFIG);
		expect(result.entitiesReceived).toBe(1);
		expect(result.vssRefreshed).toBe(1);

		const vss = await db.execute("SELECT COUNT(*) as count FROM entities_vss");
		expect((vss.rows[0] as { count: number }).count).toBe(1);
	});
});
