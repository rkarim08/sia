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

	const editContent = oldStr && newStr ? `--- ${oldStr}\n+++ ${newStr}` : "edit";

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

	return { status: "processed", nodes_created: 1 };
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

	// Detect errors in output
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

	return { status: "processed", nodes_created: nodesCreated };
}

async function handleRead(_db: SiaDb, _event: HookEvent): Promise<HookResponse> {
	// Read events signal importance but don't create new entities.
	// touchEntity requires a known entity id — we can't determine that from
	// just a file path without a lookup. For now, record the access signal
	// without a touch call. Future: look up FileNode by path and touch.
	return { status: "processed", nodes_created: 0 };
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
