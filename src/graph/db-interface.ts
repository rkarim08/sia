// Module: db-interface — SiaDb interface and BunSqliteDb adapter

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SyncConfig } from "@/shared/config";
import { SIA_HOME } from "@/shared/config";

/** Returns true for SQL statements that produce rows (SELECT, PRAGMA, RETURNING, etc.) */
function isReadStatement(sql: string): boolean {
	const trimmed = sql.trimStart().toUpperCase();
	return (
		trimmed.startsWith("SELECT") ||
		trimmed.startsWith("PRAGMA") ||
		trimmed.startsWith("WITH") ||
		trimmed.startsWith("EXPLAIN") ||
		trimmed.includes("RETURNING")
	);
}

/**
 * Unified database adapter interface.
 * All CRUD code writes against SiaDb, never directly against bun:sqlite or @libsql/client.
 */
export interface SiaDb {
	execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
	executeMany(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
	transaction(fn: (db: SiaDb) => Promise<void>): Promise<void>;
	close(): Promise<void>;
	rawSqlite(): Database | null;
	sync?(): Promise<void>;
}

/**
 * Bun:sqlite implementation of SiaDb (used when sync.enabled = false).
 */
export class BunSqliteDb implements SiaDb {
	constructor(private readonly db: Database) {}

	async execute(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
		const stmt = this.db.prepare(sql);
		if (isReadStatement(sql)) {
			const rows = stmt.all(...(params as SQLQueryBindings[])) as Record<string, unknown>[];
			return { rows };
		}
		stmt.run(...(params as SQLQueryBindings[]));
		return { rows: [] };
	}

	async executeMany(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
		for (const { sql, params = [] } of statements) {
			this.db.prepare(sql).run(...(params as SQLQueryBindings[]));
		}
	}

	async transaction(fn: (db: SiaDb) => Promise<void>): Promise<void> {
		// bun:sqlite's db.transaction() is synchronous — passing an async callback
		// would commit before awaited operations complete (torn writes).
		// Instead, manage transaction boundaries explicitly around the async fn.
		//
		// Pass a proxy to fn rather than `this` so that any nested call to
		// txProxy.transaction() throws immediately with a clear error message,
		// matching LibSqlDb's behaviour.
		const txProxy: SiaDb = {
			execute: (sql, params) => this.execute(sql, params),
			executeMany: (stmts) => this.executeMany(stmts),
			transaction: () => {
				throw new Error("Nested transactions not supported");
			},
			close: async () => {},
			rawSqlite: () => this.db,
		};
		this.db.prepare("BEGIN").run();
		try {
			await fn(txProxy);
			this.db.prepare("COMMIT").run();
		} catch (e) {
			this.db.prepare("ROLLBACK").run();
			throw e;
		}
	}

	async close(): Promise<void> {
		this.db.close();
	}

	rawSqlite(): Database {
		return this.db;
	}

	async sync(): Promise<void> {
		// No-op for local-only mode
	}
}

/**
 * Create an in-memory BunSqliteDb instance (for testing).
 */
export function createMemoryDb(): BunSqliteDb {
	return new BunSqliteDb(new Database(":memory:"));
}

// ---------------------------------------------------------------------------
// LibSqlDb — embedded replica via @libsql/client
// ---------------------------------------------------------------------------

export class LibSqlDb implements SiaDb {
	constructor(
		private readonly client: {
			execute: (...args: unknown[]) => Promise<{ rows?: unknown[] }>;
			batch?: (...args: unknown[]) => Promise<unknown>;
			sync?: () => Promise<void>;
			close?: () => Promise<void>;
		},
	) {}

	async execute(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
		const result = await this.client.execute({ sql, args: params as unknown[] });
		const rows = Array.isArray(result?.rows)
			? result.rows.map((row: unknown) => row as Record<string, unknown>)
			: [];
		return { rows };
	}

	async executeMany(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
		if (typeof this.client.batch === "function") {
			await this.client.batch(
				statements.map(({ sql, params = [] }) => ({ sql, args: params as unknown[] })),
				"deferred",
			);
			return;
		}

		for (const { sql, params = [] } of statements) {
			await this.client.execute({ sql, args: params as unknown[] });
		}
	}

	async transaction(fn: (db: SiaDb) => Promise<void>): Promise<void> {
		const txProxy: SiaDb = {
			execute: (sql, params) => this.execute(sql, params),
			executeMany: (stmts) => this.executeMany(stmts),
			transaction: async () => {
				throw new Error("Nested transactions not supported");
			},
			close: async () => {},
			rawSqlite: () => null,
		};

		await this.client.execute("BEGIN");
		try {
			await fn(txProxy);
			await this.client.execute("COMMIT");
		} catch (err) {
			await this.client.execute("ROLLBACK");
			throw err;
		}
	}

	async close(): Promise<void> {
		if (typeof this.client.close === "function") {
			await this.client.close();
		}
	}

	rawSqlite(): Database | null {
		return null;
	}

	async sync(): Promise<void> {
		if (typeof this.client.sync === "function") {
			await this.client.sync();
		}
	}
}

// ---------------------------------------------------------------------------
// openDb factory & openSiaDb router
// ---------------------------------------------------------------------------

/** Options for openDb / openSiaDb. */
export interface OpenDbOpts {
	readonly?: boolean;
	/** Override SIA_HOME (useful for testing). */
	siaHome?: string;
}

/**
 * Open (or create) a bun:sqlite database at `{siaHome}/repos/{repoHash}/graph.db`.
 * Sets WAL journal mode, NORMAL synchronous, and foreign_keys ON unless `readonly`.
 */
export function openDb(repoHash: string, opts: OpenDbOpts = {}): BunSqliteDb {
	const home = opts.siaHome ?? SIA_HOME;
	const dir = join(home, "repos", repoHash);
	mkdirSync(dir, { recursive: true });

	const dbPath = join(dir, "graph.db");
	const db = new Database(dbPath, { readonly: opts.readonly ?? false });

	if (!opts.readonly) {
		(db as unknown as { pragma: (s: string) => void }).pragma("journal_mode = WAL");
		(db as unknown as { pragma: (s: string) => void }).pragma("synchronous = NORMAL");
		(db as unknown as { pragma: (s: string) => void }).pragma("foreign_keys = ON");
	}

	return new BunSqliteDb(db);
}

/**
 * Open the appropriate SiaDb implementation based on SyncConfig.
 *
 * - sync disabled or no serverUrl  => local bun:sqlite via openDb
 * - sync enabled + serverUrl       => dynamic import createSiaDb from @/sync/client
 */
export async function openSiaDb(
	repoHash: string,
	syncConfig: SyncConfig,
	opts: OpenDbOpts = {},
): Promise<SiaDb> {
	if (!syncConfig.enabled || !syncConfig.serverUrl) {
		return openDb(repoHash, opts);
	}

	// Dynamic import so that @/sync/client is only loaded when sync is actually used
	const { createSiaDb } = await import("@/sync/client");
	return createSiaDb(repoHash, syncConfig, opts);
}
