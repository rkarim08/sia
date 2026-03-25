// Module: index-worker — Worker thread entry point for parallel AST indexing.
//
// Each worker receives file paths from the main thread, reads the file,
// parses it with tree-sitter via dispatchExtractionAsync, and returns
// extracted facts. Includes per-file retry with exponential backoff.
//
// This module exports parseFileWithRetry for direct testing.
// When run as a worker thread, it listens on parentPort (Node) or self.onmessage (Bun) for messages.

import { readFileSync, statSync } from "node:fs";
import { dispatchExtractionAsync } from "@/ast/extractors/tier-dispatch";
import { getLanguageForFile } from "@/ast/languages";
import { detectPackagePath } from "@/ast/path-utils";
import type { CandidateFact } from "@/capture/types";

const MAX_RETRIES = 3;

export interface WorkerMessage {
	absPath: string;
	relPath: string;
}

export interface WorkerResult {
	relPath: string;
	mtimeMs: number;
	packagePath: string | null;
	facts: CandidateFact[];
	error?: string;
}

/**
 * Parse a single file with retry logic.
 * Exported for direct testing — also used by the worker thread message handler.
 */
export async function parseFileWithRetry(absPath: string, relPath: string): Promise<WorkerResult> {
	const language = getLanguageForFile(absPath);
	if (!language) {
		return { relPath, mtimeMs: 0, packagePath: null, facts: [] };
	}

	let lastError: string | undefined;

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			const stat = statSync(absPath);
			const content = readFileSync(absPath, "utf-8");
			const facts = await dispatchExtractionAsync(
				content,
				relPath,
				language.tier,
				language.name,
				language.specialHandling,
			);
			const packagePath = detectPackagePath(relPath);

			return {
				relPath,
				mtimeMs: stat.mtimeMs,
				packagePath,
				// Convert to plain objects for structured clone across threads
				facts: facts.map((f) => ({ ...f })),
			};
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			if (attempt < MAX_RETRIES) {
				// Exponential backoff: 50ms, 200ms, 800ms
				await new Promise((r) => setTimeout(r, 50 * 4 ** (attempt - 1)));
			}
		}
	}

	return {
		relPath,
		mtimeMs: 0,
		packagePath: null,
		facts: [],
		error: `Failed after ${MAX_RETRIES} attempts: ${lastError}`,
	};
}

// --- Worker thread auto-setup ---
// Bun: use Web Worker API (self.onmessage). Checked first because bun also
// exposes node:worker_threads which would falsely match the Node path.
// Node: use worker_threads parentPort.
if (typeof globalThis.Bun !== "undefined") {
	if (typeof self !== "undefined" && typeof self.postMessage === "function") {
		self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
			const result = await parseFileWithRetry(event.data.absPath, event.data.relPath);
			self.postMessage(result);
		};
	}
} else {
	try {
		const wt = require("node:worker_threads") as typeof import("node:worker_threads");
		if (!wt.isMainThread && wt.parentPort) {
			wt.parentPort.on("message", async (msg: WorkerMessage) => {
				const result = await parseFileWithRetry(msg.absPath, msg.relPath);
				wt.parentPort!.postMessage(result);
			});
		}
	} catch {
		// Not in a worker context (imported for testing) — ignore
	}
}
