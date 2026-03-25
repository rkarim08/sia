// Module: sia-execute — Execute code in a sandbox subprocess with throttle + context mode

import type { z } from "zod";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import type { SiaExecuteInput as SiaExecuteInputSchema } from "@/mcp/server";
import type { ProgressiveThrottle } from "@/retrieval/throttle";
import type { ContextModeResult } from "@/sandbox/context-mode";
import { applyContextMode, lineChunker } from "@/sandbox/context-mode";
import { buildSandboxEnv } from "@/sandbox/credential-pass";
import { executeSubprocess } from "@/sandbox/executor";

export type SiaExecuteInput = z.infer<typeof SiaExecuteInputSchema>;

export interface SiaExecuteConfig {
	sandboxTimeoutMs: number;
	sandboxOutputMaxBytes: number;
	contextModeThreshold: number;
	contextModeTopK: number;
}

const DEFAULT_CONFIG: SiaExecuteConfig = {
	sandboxTimeoutMs: 30_000,
	sandboxOutputMaxBytes: 1_048_576,
	contextModeThreshold: 10_240,
	contextModeTopK: 5,
};

export interface SiaExecuteResult {
	stdout?: string;
	stderr?: string;
	exitCode?: number | null;
	timedOut?: boolean;
	truncated?: boolean;
	runtimeMs?: number;
	contextMode?: ContextModeResult;
	error?: string;
}

/**
 * Handle a sia_execute request: throttle check, sandbox execution, optional context mode.
 */
export async function handleSiaExecute(
	db: SiaDb,
	input: SiaExecuteInput,
	embedder: Embedder | null,
	throttle: ProgressiveThrottle,
	sessionId: string,
	config?: Partial<SiaExecuteConfig>,
): Promise<SiaExecuteResult> {
	const cfg: SiaExecuteConfig = { ...DEFAULT_CONFIG, ...config };

	// 1. Throttle check — if blocked, return error
	const throttleResult = await throttle.check(sessionId, "sia_execute");
	if (throttleResult.mode === "blocked") {
		return { error: throttleResult.warning ?? "Tool blocked for this session." };
	}

	// 2. Build sandbox env
	const env = buildSandboxEnv(input.env);

	// 3. Execute subprocess
	const result = await executeSubprocess({
		language: input.language,
		code: input.code,
		timeout: input.timeout ?? cfg.sandboxTimeoutMs,
		env,
		outputMaxBytes: cfg.sandboxOutputMaxBytes,
	});

	// 4. Apply context mode if output large + intent provided + embedder available
	if (embedder && result.stdout.length > cfg.contextModeThreshold && input.intent !== undefined) {
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
			// Omit stdout when context mode was applied
			...(contextMode.applied ? {} : { stdout: result.stdout }),
			stderr: result.stderr || undefined,
			exitCode: result.exitCode,
			timedOut: result.timedOut || undefined,
			truncated: result.truncated || undefined,
			runtimeMs: result.runtimeMs,
			contextMode,
		};
	}

	if (!embedder && result.stdout.length > cfg.contextModeThreshold && input.intent !== undefined) {
		process.stderr.write(
			"sia: context mode skipped — embedder not available. Large output returned as-is.\n",
		);
	}

	// 5. Return plain result
	return {
		stdout: result.stdout,
		stderr: result.stderr || undefined,
		exitCode: result.exitCode,
		timedOut: result.timedOut || undefined,
		truncated: result.truncated || undefined,
		runtimeMs: result.runtimeMs,
	};
}
