// Module: meta-db — Meta database opener

import { join, resolve } from "node:path";
import type { BunSqliteDb } from "@/graph/db-interface";
import { runMigrations } from "@/graph/semantic-db";
import { SIA_HOME } from "@/shared/config";

/**
 * Open (or create) the global meta database.
 * Resolves to `{siaHome}/meta.db` (not under repos/) and applies
 * migrations from the `migrations/meta` directory.
 */
export function openMetaDb(siaHome?: string): BunSqliteDb {
	const home = siaHome ?? SIA_HOME;
	const dbPath = join(home, "meta.db");
	const migrationsDir = resolve(import.meta.dirname, "../../migrations/meta");
	return runMigrations(dbPath, migrationsDir);
}
