// Module: semantic-db — Migration runner and semantic database openers

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { BunSqliteDb } from "@/graph/db-interface";

/**
 * Open (or create) a SQLite database at `dbPath`, apply WAL/NORMAL/FK pragmas,
 * then run every unapplied `.sql` file found in `migrationsDir` (sorted
 * alphabetically).  Each migration is tracked in a `_migrations` table so it
 * is never applied twice.
 *
 * Returns a `BunSqliteDb` wrapping the open connection.
 */
export function runMigrations(dbPath: string, migrationsDir: string): BunSqliteDb {
	// Ensure the parent directory for the database file exists.
	const parentDir = dirname(dbPath);
	mkdirSync(parentDir, { recursive: true });

	// Open (or create) the database.
	const db = new Database(dbPath);

	// Pragmas — WAL for concurrent reads, synchronous NORMAL for safety,
	// foreign keys enforced.
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA synchronous = NORMAL");
	db.exec("PRAGMA foreign_keys = ON");

	// Ensure the bookkeeping table exists.
	db.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			name TEXT PRIMARY KEY,
			applied_at INTEGER NOT NULL
		)
	`);

	// If the migrations directory does not exist, return early — the database
	// is usable but has no application tables yet.
	if (!existsSync(migrationsDir)) {
		return new BunSqliteDb(db);
	}

	// Discover which migrations have already been applied.
	const applied = new Set<string>(
		(db.prepare("SELECT name FROM _migrations").all() as Array<{ name: string }>).map(
			(r) => r.name,
		),
	);

	// Read .sql files from the migrations directory, sorted alphabetically so
	// that numbered prefixes control execution order (001-foo.sql before 002-bar.sql).
	const files = readdirSync(migrationsDir)
		.filter((f) => f.endsWith(".sql"))
		.sort();

	for (const file of files) {
		if (applied.has(file)) continue;

		const sql = readFileSync(`${migrationsDir}/${file}`, "utf-8");
		db.exec(sql);
		db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
	}

	return new BunSqliteDb(db);
}
