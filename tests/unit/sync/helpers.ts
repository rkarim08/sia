import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

export function createTestDb(tmpDir?: string): { db: SiaDb; tmpDir: string; repoHash: string } {
	const dir = tmpDir ?? join(tmpdir(), `sia-sync-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	const repoHash = `test-${randomUUID().slice(0, 8)}`;
	const db = openGraphDb(repoHash, dir);
	return { db, tmpDir: dir, repoHash };
}
