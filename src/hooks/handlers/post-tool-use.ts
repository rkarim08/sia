// Module: post-tool-use — PostToolUse hook handler
//
// Receives events after each tool invocation and extracts knowledge:
// - Write  → FileNode entity + TrackA code entities + knowledge patterns
// - Edit   → EditEvent entity
// - Bash   → ExecutionEvent entity + git commit detection + error detection
// - Read   → touch for importance (no new entities)

import { extractTrackA } from "@/capture/track-a-ast";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { detectCommitPatterns, detectKnowledgePatterns } from "@/hooks/extractors/pattern-detector";
import type { HookEvent, HookHandler, HookResponse } from "@/hooks/types";

/** Extract the basename from a file path. */
function basename(filePath: string): string {
	const idx = filePath.lastIndexOf("/");
	return idx === -1 ? filePath : filePath.slice(idx + 1);
}

/** Safely read a string field from tool_input. */
function inputStr(event: HookEvent, key: string): string | undefined {
	const val = event.tool_input?.[key];
	return typeof val === "string" ? val : undefined;
}

/** Safely read tool_response as a string. */
function responseStr(event: HookEvent): string {
	if (typeof event.tool_response === "string") return event.tool_response;
	if (event.tool_response != null) return String(event.tool_response);
	return "";
}

// ---------------------------------------------------------------------------
// Test failure parser
// ---------------------------------------------------------------------------

/** A structured test failure parsed from test runner output. */
export interface TestFailure {
	testName: string;
	testFile: string;
	errorMessage: string;
	sourceFile?: string;
	sourceLine?: number;
}

const TEST_COMMAND_RE = /\b(test|vitest|jest|pytest|mocha)\b/;

/**
 * Parse structured test failures from test runner output.
 * Supports vitest/jest and pytest output formats.
 */
export function parseTestFailures(output: string, command: string): TestFailure[] {
	if (!TEST_COMMAND_RE.test(command)) return [];

	const failures: TestFailure[] = [];

	// --- Vitest/Jest format ---
	// Matches: ❯ path/to/test.ts (N tests | M failed)
	// Then:    × test name
	//          → ErrorType: message
	//          ❯ source.ts:line:col
	const vitestBlockRe = /❯\s+(\S+\.(?:test|spec)\.\S+)\s+\([^)]*failed[^)]*\)/g;
	let blockMatch: RegExpExecArray | null = vitestBlockRe.exec(output);
	while (blockMatch !== null) {
		const testFile = blockMatch[1];
		// Find the region of this test file block
		const blockStart = blockMatch.index + blockMatch[0].length;
		const nextBlock = output.indexOf("\n ❯ ", blockStart);
		const blockEnd = nextBlock === -1 ? output.length : nextBlock;
		const blockText = output.slice(blockStart, blockEnd);

		// Find individual failed tests: × test name
		const failRe = /×\s+(.+)/g;
		let failMatch: RegExpExecArray | null = failRe.exec(blockText);
		while (failMatch !== null) {
			const testName = failMatch[1].trim();
			// Look for error message after the test name (→ ErrorType: msg)
			const afterFail = blockText.slice(failMatch.index + failMatch[0].length);
			const errorLineMatch = afterFail.match(/→\s+(.+)/);
			const errorMessage = errorLineMatch ? errorLineMatch[1].trim() : "Test failed";

			// Look for source file in stack trace (❯ path:line:col, skip test files)
			const stackLines = afterFail.match(/❯\s+(\S+):(\d+):\d+/g) ?? [];
			let sourceFile: string | undefined;
			let sourceLine: number | undefined;
			for (const sl of stackLines) {
				const m = sl.match(/❯\s+(\S+):(\d+):\d+/);
				if (m && !m[1].match(/\.(test|spec)\./)) {
					sourceFile = m[1];
					sourceLine = Number.parseInt(m[2], 10);
					break;
				}
			}

			failures.push({ testName, testFile, errorMessage, sourceFile, sourceLine });
			failMatch = failRe.exec(blockText);
		}

		blockMatch = vitestBlockRe.exec(output);
	}

	// --- Pytest format ---
	// FAILED path::test_name - ErrorType: message
	const pytestRe = /^FAILED\s+(\S+)::(\S+)\s+-\s+(.+)$/gm;
	let pytestMatch: RegExpExecArray | null = pytestRe.exec(output);
	while (pytestMatch !== null) {
		failures.push({
			testName: pytestMatch[2],
			testFile: pytestMatch[1],
			errorMessage: pytestMatch[3].trim(),
		});
		pytestMatch = pytestRe.exec(output);
	}

	return failures;
}

// ---------------------------------------------------------------------------
// Tool-specific handlers
// ---------------------------------------------------------------------------

async function handleWrite(db: SiaDb, event: HookEvent): Promise<HookResponse> {
	const filePath = inputStr(event, "file_path");
	const content = inputStr(event, "content");

	if (!filePath || !content) {
		return { status: "skipped", nodes_created: 0 };
	}

	let nodesCreated = 0;

	// 1. Insert a FileNode entity for the written file
	await insertEntity(db, {
		type: "FileNode",
		name: basename(filePath),
		content: content.slice(0, 2000),
		summary: `File written: ${filePath}`,
		file_paths: JSON.stringify([filePath]),
		extraction_method: "hook:post-tool-use:write",
		source_episode: event.session_id,
	});
	nodesCreated++;

	// 2. Extract structural code entities via TrackA
	const trackAFacts = extractTrackA(content, filePath);
	for (const fact of trackAFacts) {
		await insertEntity(db, {
			type: fact.type,
			name: fact.name,
			content: fact.content,
			summary: fact.summary,
			tags: JSON.stringify(fact.tags),
			file_paths: JSON.stringify(fact.file_paths),
			trust_tier: fact.trust_tier,
			confidence: fact.confidence,
			extraction_method: "hook:post-tool-use:track-a",
			source_episode: event.session_id,
		});
		nodesCreated++;
	}

	// 3. Detect knowledge patterns in the content
	const patterns = detectKnowledgePatterns(content);
	for (const p of patterns) {
		await insertEntity(db, {
			type: p.type,
			name: `${p.type}: ${p.content.slice(0, 60)}`,
			content: p.content,
			summary: `${p.type} detected in ${basename(filePath)}`,
			confidence: p.confidence,
			file_paths: JSON.stringify([filePath]),
			extraction_method: "hook:post-tool-use:pattern",
			source_episode: event.session_id,
		});
		nodesCreated++;
	}

	return { status: "processed", nodes_created: nodesCreated };
}

async function handleEdit(db: SiaDb, event: HookEvent): Promise<HookResponse> {
	const filePath = inputStr(event, "file_path");
	const oldStr = inputStr(event, "old_string");
	const newStr = inputStr(event, "new_string");

	if (!filePath) {
		return { status: "skipped", nodes_created: 0 };
	}

	let nodesCreated = 0;

	const editContent = oldStr && newStr ? `--- ${oldStr}\n+++ ${newStr}` : "edit";

	// 1. Always create the EditEvent entity (existing behavior)
	await insertEntity(db, {
		type: "CodeEntity",
		name: `Edit: ${basename(filePath)}`,
		content: editContent.slice(0, 2000),
		summary: `Edit in ${filePath}`,
		file_paths: JSON.stringify([filePath]),
		extraction_method: "hook:post-tool-use:edit",
		source_episode: event.session_id,
		kind: "EditEvent",
	});
	nodesCreated++;

	// 2. Extract structural code entities from new_string via TrackA (best-effort)
	if (newStr) {
		try {
			const trackAFacts = extractTrackA(newStr, filePath);
			for (const fact of trackAFacts) {
				await insertEntity(db, {
					type: fact.type,
					name: fact.name,
					content: fact.content,
					summary: fact.summary,
					tags: JSON.stringify(fact.tags),
					file_paths: JSON.stringify(fact.file_paths),
					trust_tier: fact.trust_tier,
					confidence: fact.confidence,
					extraction_method: "hook:post-tool-use:track-a",
					source_episode: event.session_id,
				});
				nodesCreated++;
			}
		} catch {
			// Best-effort — don't block EditEvent creation
		}

		// 3. Detect knowledge patterns in new_string (best-effort)
		try {
			const patterns = detectKnowledgePatterns(newStr);
			for (const p of patterns) {
				await insertEntity(db, {
					type: p.type,
					name: `${p.type}: ${p.content.slice(0, 60)}`,
					content: p.content,
					summary: `${p.type} detected in ${basename(filePath)}`,
					confidence: p.confidence,
					file_paths: JSON.stringify([filePath]),
					extraction_method: "hook:post-tool-use:pattern",
					source_episode: event.session_id,
				});
				nodesCreated++;
			}
		} catch {
			// Best-effort — don't block EditEvent creation
		}
	}

	return { status: "processed", nodes_created: nodesCreated };
}

async function handleBash(db: SiaDb, event: HookEvent): Promise<HookResponse> {
	const command = inputStr(event, "command") ?? "";
	const output = responseStr(event);

	let nodesCreated = 0;

	// Always create an ExecutionEvent for the command
	await insertEntity(db, {
		type: "CodeEntity",
		name: `Bash: ${command.slice(0, 80)}`,
		content: `$ ${command}\n${output.slice(0, 2000)}`,
		summary: `Executed: ${command.slice(0, 120)}`,
		extraction_method: "hook:post-tool-use:bash",
		source_episode: event.session_id,
		kind: "ExecutionEvent",
	});
	nodesCreated++;

	// Detect git commit messages
	const commitMatch = command.match(/git\s+commit\s+.*-m\s+["'](.+?)["']/);
	if (commitMatch) {
		const commitMsg = commitMatch[1];
		const commitPatterns = detectCommitPatterns(commitMsg);
		for (const p of commitPatterns) {
			await insertEntity(db, {
				type: p.type,
				name: `${p.type}: ${commitMsg.slice(0, 60)}`,
				content: commitMsg,
				summary: `Commit: ${commitMsg.slice(0, 120)}`,
				confidence: p.confidence,
				extraction_method: "hook:post-tool-use:commit",
				source_episode: event.session_id,
			});
			nodesCreated++;
		}
	}

	// Detect structured test failures from test runner output
	const testFailures = parseTestFailures(output, command);
	for (const failure of testFailures) {
		const filePaths = [failure.testFile];
		if (failure.sourceFile) filePaths.push(failure.sourceFile);

		const content = [
			`Test: ${failure.testName}`,
			`File: ${failure.testFile}`,
			`Error: ${failure.errorMessage}`,
			failure.sourceFile ? `Source: ${failure.sourceFile}:${failure.sourceLine ?? "?"}` : null,
		]
			.filter(Boolean)
			.join("\n");

		await insertEntity(db, {
			type: "Bug",
			name: `${failure.testName}: ${failure.errorMessage.slice(0, 60)}`,
			content,
			summary: `Test failure in ${failure.testFile}: ${failure.testName}`,
			trust_tier: 2,
			confidence: 0.95,
			file_paths: JSON.stringify(filePaths),
			extraction_method: "hook:post-tool-use:test-runner",
			source_episode: event.session_id,
			kind: "Bug",
		});
		nodesCreated++;
	}

	// Detect errors in output (skip if structured test failures were found)
	if (testFailures.length === 0) {
		const hasError =
			/\bError\b/i.test(output) ||
			/\bfailed\b/i.test(output) ||
			/\bFATAL\b/.test(output) ||
			/\bpanic\b/i.test(output);

		if (hasError && !commitMatch) {
			await insertEntity(db, {
				type: "Bug",
				name: `Error: ${command.slice(0, 60)}`,
				content: output.slice(0, 2000),
				summary: `Error detected running: ${command.slice(0, 100)}`,
				confidence: 0.7,
				extraction_method: "hook:post-tool-use:error",
				source_episode: event.session_id,
			});
			nodesCreated++;
		}
	}

	return { status: "processed", nodes_created: nodesCreated };
}

async function handleRead(db: SiaDb, event: HookEvent): Promise<HookResponse> {
	const filePath = inputStr(event, "file_path");
	if (!filePath) {
		return { status: "processed", nodes_created: 0, context: [] };
	}

	const result = await db.execute(
		`SELECT id, type, name, summary, kind, trust_tier, confidence
		 FROM graph_nodes
		 WHERE file_paths LIKE ?
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL
		 ORDER BY importance DESC
		 LIMIT 5`,
		[`%${filePath}%`],
	);

	const context = (result.rows as Array<Record<string, unknown>>).map((row) => ({
		id: row.id,
		type: row.type,
		name: row.name,
		summary: row.summary,
		kind: row.kind,
		trust_tier: row.trust_tier,
		confidence: row.confidence,
	}));

	return { status: "processed", nodes_created: 0, context };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a PostToolUse hook handler bound to the given graph database.
 */
export function createPostToolUseHandler(db: SiaDb): HookHandler {
	return async (event: HookEvent): Promise<HookResponse> => {
		if (!event.tool_name || !event.tool_input) {
			return { status: "skipped", nodes_created: 0 };
		}

		switch (event.tool_name) {
			case "Write":
				return handleWrite(db, event);
			case "Edit":
				return handleEdit(db, event);
			case "Bash":
				return handleBash(db, event);
			case "Read":
				return handleRead(db, event);
			default:
				return { status: "skipped", nodes_created: 0 };
		}
	};
}
