// Module: sia-execute-file — Execute an existing file in a sandbox subprocess with throttle + context mode
// Raw file content never enters the agent's context window — it is copied to a temp dir and executed from there.

import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { z } from "zod";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import type { SiaExecuteFileInput as SiaExecuteFileInputSchema } from "@/mcp/server";
import type { ProgressiveThrottle } from "@/retrieval/throttle";
import type { ContextModeResult } from "@/sandbox/context-mode";
import { applyContextMode, lineChunker } from "@/sandbox/context-mode";
import { buildSandboxEnv } from "@/sandbox/credential-pass";
import { executeSubprocess } from "@/sandbox/executor";

export type SiaExecuteFileInput = z.infer<typeof SiaExecuteFileInputSchema>;

export interface SiaExecuteFileConfig {
	sandboxTimeoutMs: number;
	sandboxOutputMaxBytes: number;
	contextModeThreshold: number;
	contextModeTopK: number;
}

const DEFAULT_CONFIG: SiaExecuteFileConfig = {
	sandboxTimeoutMs: 30_000,
	sandboxOutputMaxBytes: 1_048_576,
	contextModeThreshold: 10_240,
	contextModeTopK: 5,
};

export interface SiaExecuteFileResult {
	stdout?: string;
	stderr?: string;
	exitCode?: number | null;
	timedOut?: boolean;
	runtimeMs?: number;
	contextMode?: ContextModeResult;
	error?: string;
}

/**
 * Handle a sia_execute_file request: validate file exists, throttle check,
 * copy to sandbox temp dir, execute, apply optional context mode.
 */
export async function handleSiaExecuteFile(
	db: SiaDb,
	input: SiaExecuteFileInput,
	embedder: Embedder,
	throttle: ProgressiveThrottle,
	sessionId: string,
	config?: Partial<SiaExecuteFileConfig>,
): Promise<SiaExecuteFileResult> {
	const cfg: SiaExecuteFileConfig = { ...DEFAULT_CONFIG, ...config };

	// 1. Validate file exists
	if (!existsSync(input.file_path)) {
		return { error: `File not found: ${input.file_path}` };
	}

	// 2. Throttle check — if blocked, return error
	const throttleResult = await throttle.check(sessionId, "sia_execute_file");
	if (throttleResult.mode === "blocked") {
		return { error: throttleResult.warning ?? "Tool blocked for this session." };
	}

	// 3. Copy file to sandbox temp dir so raw content stays on disk, not in context
	const sandboxDir = mkdtempSync(join(tmpdir(), "sia-exec-file-"));
	const copiedPath = join(sandboxDir, basename(input.file_path));
	copyFileSync(input.file_path, copiedPath);

	// 4. Build sandbox env
	const env = buildSandboxEnv();

	// 5. Execute subprocess using the copied file path
	const result = await executeSubprocess({
		language: input.language,
		filePath: copiedPath,
		code: "",
		timeout: input.timeout ?? cfg.sandboxTimeoutMs,
		cwd: sandboxDir,
		env,
		outputMaxBytes: cfg.sandboxOutputMaxBytes,
	});
	try {
		rmSync(sandboxDir, { recursive: true, force: true });
	} catch (e) {
		console.error("[sia-execute-file] cleanup failed:", (e as Error).message);
	}

	// 6. Apply context mode if output large + intent provided
	if (result.stdout.length > cfg.contextModeThreshold && input.intent !== undefined) {
		const contextMode = await applyContextMode(
			result.stdout,
			input.intent,
			lineChunker,
			db,
			embedder,
			sessionId,
			{ threshold: cfg.contextModeThreshold, topK: cfg.contextModeTopK },
		);

		return {
			...(contextMode.applied ? {} : { stdout: result.stdout }),
			stderr: result.stderr || undefined,
			exitCode: result.exitCode,
			timedOut: result.timedOut || undefined,
			runtimeMs: result.runtimeMs,
			contextMode,
		};
	}

	// 7. Return plain result
	return {
		stdout: result.stdout,
		stderr: result.stderr || undefined,
		exitCode: result.exitCode,
		timedOut: result.timedOut || undefined,
		runtimeMs: result.runtimeMs,
	};
}
