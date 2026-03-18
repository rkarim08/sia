// Module: semantic-db — Migration runner and semantic database openers

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BunSqliteDb } from "@/graph/db-interface";
import { SIA_HOME } from "@/shared/config";

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

	// page_size must come first — only effective on a brand-new file before any
	// tables exist; silently a no-op on existing databases.
	db.exec("PRAGMA page_size = 4096");

	// WAL for concurrent reads, synchronous NORMAL for safety,
	// foreign keys enforced.
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA synchronous = NORMAL");
	db.exec("PRAGMA foreign_keys = ON");

	// Performance hardening: memory-mapped I/O (1 GB virtual window, demand-paged
	// by the OS), temp tables kept in RAM, and a 64 MB page cache.
	db.exec("PRAGMA mmap_size = 1073741824");
	db.exec("PRAGMA temp_store = MEMORY");
	db.exec("PRAGMA cache_size = -64000");

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

/**
 * Open (or create) the semantic graph database for a given repo.
 * Resolves to `{siaHome}/repos/{repoHash}/graph.db` and applies
 * migrations from the `migrations/semantic` directory.
 */
export function openGraphDb(repoHash: string, siaHome?: string): BunSqliteDb {
	const home = siaHome ?? SIA_HOME;
	const dbPath = join(home, "repos", repoHash, "graph.db");
	const migrationsDir = resolve(import.meta.dirname, "../../migrations/semantic");
	return runMigrations(dbPath, migrationsDir);
}

/**
 * Open (or create) the episodic database for a given repo.
 * Resolves to `{siaHome}/repos/{repoHash}/episodic.db` and applies
 * migrations from the `migrations/episodic` directory.
 */
export function openEpisodicDb(repoHash: string, siaHome?: string): BunSqliteDb {
	const home = siaHome ?? SIA_HOME;
	const dbPath = join(home, "repos", repoHash, "episodic.db");
	const migrationsDir = resolve(import.meta.dirname, "../../migrations/episodic");
	return runMigrations(dbPath, migrationsDir);
}
