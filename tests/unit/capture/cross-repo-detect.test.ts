import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectCrossRepoEdges } from "@/capture/pipeline";
import type { CandidateFact } from "@/capture/types";
import { openBridgeDb } from "@/graph/bridge-db";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeCandidate(content: string): CandidateFact {
	return {
		type: "Concept",
		name: content.slice(0, 50),
		content,
		summary: content.slice(0, 80),
		tags: [],
		file_paths: [],
		trust_tier: 2,
		confidence: 0.8,
	};
}

describe("detectCrossRepoEdges", () => {
	let tmpDir: string;
	let graphDb: SiaDb | undefined;
	let bridgeDb: SiaDb | undefined;

	afterEach(async () => {
		if (graphDb) {
			await graphDb.close();
			graphDb = undefined;
		}
		if (bridgeDb) {
			await bridgeDb.close();
			bridgeDb = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// Returns 0 when no patterns found
	// ---------------------------------------------------------------

	it("returns 0 when no cross-repo patterns found in content", () => {
		tmpDir = makeTmp();
		graphDb = openGraphDb("cross-repo-none", tmpDir);
		bridgeDb = openBridgeDb(tmpDir);

		const candidates = [
			makeCandidate("A simple function that processes user input and returns a result"),
			makeCandidate("Database migration script for adding user table columns"),
		];

		const count = detectCrossRepoEdges(graphDb, bridgeDb, candidates, "repo-hash-1");

		expect(count).toBe(0);
	});

	// ---------------------------------------------------------------
	// Returns count when workspace:* pattern found
	// ---------------------------------------------------------------

	it("returns count when workspace:* pattern found in content", () => {
		tmpDir = makeTmp();
		graphDb = openGraphDb("cross-repo-ws", tmpDir);
		bridgeDb = openBridgeDb(tmpDir);

		const candidates = [
			makeCandidate('{ "dependencies": { "@myorg/shared": "workspace:*" } }'),
			makeCandidate("A normal function with no cross-repo references"),
			makeCandidate('{ "devDependencies": { "@myorg/utils": "workspace:*" } }'),
		];

		const count = detectCrossRepoEdges(graphDb, bridgeDb, candidates, "repo-hash-2");

		expect(count).toBe(2);
	});

	// ---------------------------------------------------------------
	// Returns count when "references": pattern found
	// ---------------------------------------------------------------

	it("returns count when TypeScript references pattern found in content", () => {
		tmpDir = makeTmp();
		graphDb = openGraphDb("cross-repo-refs", tmpDir);
		bridgeDb = openBridgeDb(tmpDir);

		const candidates = [makeCandidate('{ "references": [{ "path": "../shared" }] }')];

		const count = detectCrossRepoEdges(graphDb, bridgeDb, candidates, "repo-hash-3");

		expect(count).toBe(1);
	});

	// ---------------------------------------------------------------
	// Counts both patterns in a single candidate
	// ---------------------------------------------------------------

	it("counts both workspace and references patterns in one candidate", () => {
		tmpDir = makeTmp();
		graphDb = openGraphDb("cross-repo-both", tmpDir);
		bridgeDb = openBridgeDb(tmpDir);

		const candidates = [
			makeCandidate(
				'{ "dependencies": { "@myorg/shared": "workspace:*" }, "references": [{ "path": "../core" }] }',
			),
		];

		const count = detectCrossRepoEdges(graphDb, bridgeDb, candidates, "repo-hash-4");

		expect(count).toBe(2);
	});
});
