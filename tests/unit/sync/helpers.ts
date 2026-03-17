import { createMemoryDb } from "@/graph/db-interface";
import type { SiaDb } from "@/graph/db-interface";

export async function createTestDb(): Promise<SiaDb> {
        const db = createMemoryDb();
        await setupTables(db);
        return db;
}

export async function setupTables(db: SiaDb): Promise<void> {
        await db.execute(`CREATE TABLE entities (
                id TEXT PRIMARY KEY,
                type TEXT,
                name TEXT,
                content TEXT,
                summary TEXT,
                visibility TEXT,
                workspace_scope TEXT,
                hlc_modified INTEGER,
                synced_at INTEGER,
                t_valid_from INTEGER,
                t_valid_until INTEGER,
                archived_at INTEGER,
                conflict_group_id TEXT,
                embedding BLOB,
                created_by TEXT
        )`);

        await db.execute(`CREATE TABLE edges (
                id TEXT PRIMARY KEY,
                from_id TEXT,
                to_id TEXT,
                type TEXT,
                t_valid_until INTEGER,
                hlc_modified INTEGER
        )`);

        await db.execute(`CREATE TABLE audit_log (
                id TEXT,
                ts INTEGER,
                operation TEXT,
                entity_id TEXT,
                edge_id TEXT,
                source_episode TEXT,
                trust_tier INTEGER,
                extraction_method TEXT,
                source_hash TEXT,
                developer_id TEXT,
                snapshot_id TEXT
        )`);

        await db.execute(`CREATE TABLE sync_dedup_log (
                entity_a_id TEXT NOT NULL,
                entity_b_id TEXT NOT NULL,
                peer_id TEXT NOT NULL,
                decision TEXT NOT NULL,
                checked_at INTEGER NOT NULL,
                PRIMARY KEY (entity_a_id, entity_b_id, peer_id)
        )`);

        await db.execute(`CREATE TABLE entities_vss (
                rowid INTEGER PRIMARY KEY,
                embedding BLOB
        )`);
}
