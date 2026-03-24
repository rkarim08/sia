// Module: learn-progress — Cross-crash recovery for sia-learn.
//
// Writes a .sia-learn-progress.json file to the project root tracking
// which phases completed and how many files were indexed. On re-run
// after a crash, the orchestrator reads this file and resumes.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PROGRESS_FILE = ".sia-learn-progress.json";

export interface LearnProgress {
	started_at: number;
	repo_hash: string;
	branch: string;
	phases_completed: number[];
	files_indexed: number;
	total_files: number;
	last_checkpoint_at: number;
}

/**
 * Read the progress file from a directory. Returns null if not found or invalid.
 */
export function readProgress(dir: string): LearnProgress | null {
	const path = join(dir, PROGRESS_FILE);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as LearnProgress;
	} catch {
		return null;
	}
}

/**
 * Write (or update) the progress file.
 */
export function writeProgress(dir: string, progress: LearnProgress): void {
	const path = join(dir, PROGRESS_FILE);
	writeFileSync(path, JSON.stringify(progress, null, 2), "utf-8");
}

/**
 * Delete the progress file (called on successful completion).
 */
export function deleteProgress(dir: string): void {
	const path = join(dir, PROGRESS_FILE);
	try {
		unlinkSync(path);
	} catch {
		// File doesn't exist — that's fine
	}
}

/**
 * Run a function with retry and exponential backoff.
 * Returns the result on success, or null if all retries are exhausted.
 *
 * @param phaseName - Name for logging
 * @param fn - The async function to run
 * @param maxRetries - Maximum attempts (default 3)
 * @param baseDelayMs - Base delay for backoff (default 1000ms)
 */
export async function runWithRetry<T>(
	phaseName: string,
	fn: () => Promise<T>,
	maxRetries: number = 3,
	baseDelayMs: number = 1000,
): Promise<T | null> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(
				`[sia-learn] ${phaseName} failed (attempt ${attempt}/${maxRetries}): ${msg}\n`,
			);
			if (attempt === maxRetries) {
				process.stderr.write(`[sia-learn] ${phaseName} failed permanently — skipping\n`);
				return null;
			}
			// Exponential backoff: base * 4^(attempt-1)
			await new Promise((r) => setTimeout(r, baseDelayMs * 4 ** (attempt - 1)));
		}
	}
	return null;
}
