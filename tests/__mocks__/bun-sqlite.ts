// Shim: re-export better-sqlite3's default as named export `Database`
// so that `import { Database } from "bun:sqlite"` resolves in vitest (Node.js)
import BetterSqlite3 from "better-sqlite3";

export const Database = BetterSqlite3;
