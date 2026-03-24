import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import {
	createPostToolUseHandler,
	parseTestFailures,
} from "@/hooks/handlers/post-tool-use";
import type { HookEvent } from "@/hooks/types";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("handleRead — proactive knowledge injection", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("should query graph for file-related entities when a file is read", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("read-knowledge", tmpDir);

		await insertEntity(db, {
			type: "Decision",
			name: "Use JWT for auth",
			content: "We chose JWT tokens over session cookies",
			summary: "JWT auth decision",
			file_paths: JSON.stringify(["src/auth/login.ts"]),
		});

		const handler = createPostToolUseHandler(db);
		const event: HookEvent = {
			session_id: "test",
			transcript_path: "",
			cwd: process.cwd(),
			hook_event_name: "PostToolUse",
			tool_name: "Read",
			tool_input: { file_path: "src/auth/login.ts" },
		};

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect((result as any).context).toBeDefined();
		expect((result as any).context.length).toBeGreaterThan(0);
		expect((result as any).context[0].name).toBe("Use JWT for auth");
	});

	it("should return empty context for files with no knowledge", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("read-empty", tmpDir);

		const handler = createPostToolUseHandler(db);
		const event: HookEvent = {
			session_id: "test",
			transcript_path: "",
			cwd: process.cwd(),
			hook_event_name: "PostToolUse",
			tool_name: "Read",
			tool_input: { file_path: "src/unknown/file.ts" },
		};

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect((result as any).context).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// parseTestFailures — unit tests
// ---------------------------------------------------------------------------

describe("parseTestFailures", () => {
	it("should parse vitest/jest FAIL output into structured failures", () => {
		const output = `
 ❯ tests/unit/graph/entities.test.ts (3 tests | 1 failed)
   × should insert entity with defaults
     → AssertionError: expected 'CodeEntity' to be 'Decision'
      ❯ tests/unit/graph/entities.test.ts:42:15
   ✓ should update entity
   ✓ should archive entity

 Test Files  1 failed (1)
 Tests  1 failed | 2 passed (3)
`;
		const failures = parseTestFailures(output, "bun run test");
		expect(failures.length).toBeGreaterThanOrEqual(1);
		expect(failures[0].testName).toBe("should insert entity with defaults");
		expect(failures[0].testFile).toBe("tests/unit/graph/entities.test.ts");
		expect(failures[0].errorMessage).toContain("AssertionError");
	});

	it("should parse pytest FAILED output into structured failures", () => {
		const output = `
FAILED tests/test_auth.py::test_login_redirect - AssertionError: expected 302 got 200
FAILED tests/test_auth.py::test_logout - ValueError: invalid session
PASSED tests/test_auth.py::test_signup
`;
		const failures = parseTestFailures(output, "pytest");
		expect(failures).toHaveLength(2);
		expect(failures[0].testName).toBe("test_login_redirect");
		expect(failures[0].testFile).toBe("tests/test_auth.py");
		expect(failures[0].errorMessage).toContain("AssertionError");
		expect(failures[1].testName).toBe("test_logout");
		expect(failures[1].errorMessage).toContain("ValueError");
	});

	it("should extract source file from stack traces", () => {
		const output = `
 ❯ tests/unit/hooks/post-tool-use.test.ts (2 tests | 1 failed)
   × should handle bash errors
     → Error: connection refused
      ❯ src/hooks/handlers/post-tool-use.ts:45:10
      ❯ tests/unit/hooks/post-tool-use.test.ts:20:5
`;
		const failures = parseTestFailures(output, "vitest");
		expect(failures.length).toBe(1);
		expect(failures[0].sourceFile).toBe("src/hooks/handlers/post-tool-use.ts");
		expect(failures[0].sourceLine).toBe(45);
	});

	it("should return empty array for passing test output", () => {
		const output = `
 ✓ tests/unit/graph/entities.test.ts (3 tests)
 Test Files  0 failed (1)
 Tests  3 passed (3)
`;
		const failures = parseTestFailures(output, "vitest");
		expect(failures).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// handleBash — structured test failure Bug entities
// ---------------------------------------------------------------------------

describe("handleBash — structured test failure Bug entities", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("should create structured Bug entities from vitest failures", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("bash-test-fail", tmpDir);

		const vitestOutput = `
 ❯ tests/unit/graph/entities.test.ts (3 tests | 1 failed)
   × should insert entity with defaults
     → AssertionError: expected 'CodeEntity' to be 'Decision'
      ❯ src/graph/entities.ts:55:10
      ❯ tests/unit/graph/entities.test.ts:42:15
   ✓ should update entity

 Test Files  1 failed (1)
 Tests  1 failed | 1 passed (2)
`;

		const handler = createPostToolUseHandler(db);
		const event: HookEvent = {
			session_id: "test",
			transcript_path: "",
			cwd: process.cwd(),
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			tool_input: { command: "bun run test -- tests/unit/graph/entities.test.ts" },
			tool_response: vitestOutput,
		};

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_created).toBeGreaterThanOrEqual(2); // ExecutionEvent + at least 1 Bug

		// Check that a structured Bug entity was created
		const { rows } = await db.execute(
			"SELECT * FROM graph_nodes WHERE type = 'Bug' AND extraction_method = 'hook:post-tool-use:test-runner'",
		);
		expect(rows.length).toBeGreaterThanOrEqual(1);
		const bug = rows[0] as Record<string, unknown>;
		expect(bug.name).toContain("should insert entity with defaults");
		expect(bug.trust_tier).toBe(2);
		expect(bug.kind).toBe("Bug");
	});

	it("should skip generic error detection when structured failures found", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("bash-no-generic", tmpDir);

		const vitestOutput = `
 ❯ tests/unit/foo.test.ts (1 tests | 1 failed)
   × should work
     → Error: something broke
      ❯ tests/unit/foo.test.ts:10:5

 Test Files  1 failed (1)
 Tests  1 failed (1)
`;

		const handler = createPostToolUseHandler(db);
		const event: HookEvent = {
			session_id: "test",
			transcript_path: "",
			cwd: process.cwd(),
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			tool_input: { command: "bun run test" },
			tool_response: vitestOutput,
		};

		await handler(event);

		// Should NOT have a generic error Bug (extraction_method: hook:post-tool-use:error)
		const { rows: genericBugs } = await db.execute(
			"SELECT * FROM graph_nodes WHERE extraction_method = 'hook:post-tool-use:error'",
		);
		expect(genericBugs.length).toBe(0);

		// Should have structured test Bug
		const { rows: testBugs } = await db.execute(
			"SELECT * FROM graph_nodes WHERE extraction_method = 'hook:post-tool-use:test-runner'",
		);
		expect(testBugs.length).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// handleEdit — enhanced knowledge extraction
// ---------------------------------------------------------------------------

describe("handleEdit — enhanced knowledge extraction", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("should create EditEvent AND code entities from new_string", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edit-enhanced", tmpDir);

		const newContent = `export function calculateTotal(items: Item[]): number {
	return items.reduce((sum, item) => sum + item.price, 0);
}`;

		const handler = createPostToolUseHandler(db);
		const event: HookEvent = {
			session_id: "test",
			transcript_path: "",
			cwd: process.cwd(),
			hook_event_name: "PostToolUse",
			tool_name: "Edit",
			tool_input: {
				file_path: "src/cart/totals.ts",
				old_string: "// placeholder",
				new_string: newContent,
			},
		};

		const result = await handler(event);
		expect(result.status).toBe("processed");
		// Should have created more than just the EditEvent
		expect(result.nodes_created).toBeGreaterThan(1);

		// EditEvent entity should exist
		const { rows: editRows } = await db.execute(
			"SELECT * FROM graph_nodes WHERE kind = 'EditEvent'",
		);
		expect(editRows.length).toBe(1);

		// TrackA code entity should exist for the exported function
		const { rows: codeRows } = await db.execute(
			"SELECT * FROM graph_nodes WHERE extraction_method = 'hook:post-tool-use:track-a'",
		);
		expect(codeRows.length).toBeGreaterThanOrEqual(1);
		expect((codeRows[0] as Record<string, unknown>).name).toBe("calculateTotal");
	});

	it("should still create EditEvent even if new_string has no extractable entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edit-no-extract", tmpDir);

		const handler = createPostToolUseHandler(db);
		const event: HookEvent = {
			session_id: "test",
			transcript_path: "",
			cwd: process.cwd(),
			hook_event_name: "PostToolUse",
			tool_name: "Edit",
			tool_input: {
				file_path: "config.json",
				old_string: '"port": 3000',
				new_string: '"port": 8080',
			},
		};

		const result = await handler(event);
		expect(result.status).toBe("processed");
		expect(result.nodes_created).toBeGreaterThanOrEqual(1);

		const { rows } = await db.execute(
			"SELECT * FROM graph_nodes WHERE kind = 'EditEvent'",
		);
		expect(rows.length).toBe(1);
	});
});
