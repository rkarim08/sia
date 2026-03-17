// Module: bridge-db — Bridge database opener

import { join, resolve } from "node:path";
import type { BunSqliteDb } from "@/graph/db-interface";
import { runMigrations } from "@/graph/semantic-db";
import { SIA_HOME } from "@/shared/config";

/**
 * Open (or create) the global bridge database.
 * Resolves to `{siaHome}/bridge.db` (not under repos/) and applies
 * migrations from the `migrations/bridge` directory.
 */
export function openBridgeDb(siaHome?: string): BunSqliteDb {
	const home = siaHome ?? SIA_HOME;
	const dbPath = join(home, "bridge.db");
	const migrationsDir = resolve(import.meta.dirname, "../../migrations/bridge");
	return runMigrations(dbPath, migrationsDir);
}
