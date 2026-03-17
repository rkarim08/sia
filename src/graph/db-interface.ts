// Module: db-interface — SiaDb interface and BunSqliteDb adapter
import { Database } from "bun:sqlite";

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
}

/**
 * Bun:sqlite implementation of SiaDb (used when sync.enabled = false).
 */
export class BunSqliteDb implements SiaDb {
	constructor(private readonly db: Database) {}

	async execute(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
		const stmt = this.db.prepare(sql);
		if (isReadStatement(sql)) {
			const rows = stmt.all(...params) as Record<string, unknown>[];
			return { rows };
		}
		stmt.run(...params);
		return { rows: [] };
	}

	async executeMany(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
		for (const { sql, params = [] } of statements) {
			this.db.prepare(sql).run(...params);
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
}

/**
 * Create an in-memory BunSqliteDb instance (for testing).
 */
export function createMemoryDb(): BunSqliteDb {
	return new BunSqliteDb(new Database(":memory:"));
}
