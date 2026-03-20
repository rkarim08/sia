// Module: sia-batch-execute — Execute multiple operations in one call with precedes edges

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import type { ProgressiveThrottle } from "@/retrieval/throttle";
import { buildSandboxEnv } from "@/sandbox/credential-pass";
import { executeSubprocess } from "@/sandbox/executor";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

const BatchOperation = z.union([
	z.object({
		type: z.literal("execute"),
		code: z.string(),
		language: z.string().optional(),
		timeout: z.number().optional(),
		env: z.record(z.string()).optional(),
	}),
	z.object({
		type: z.literal("search"),
		query: z.string(),
	}),
]);

export const SiaBatchExecuteInput = z.object({
	operations: z.array(BatchOperation),
});

export interface OperationResult {
	index: number;
	type: string;
	stdout?: string;
	stderr?: string;
	exitCode?: number | null;
	error?: string;
}

export interface SiaBatchExecuteResult {
	results: OperationResult[];
	eventNodeIds: string[];
	contextSavings: number;
	error?: string;
}

const BATCH_MAX = 20;
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// handleSiaBatchExecute
// ---------------------------------------------------------------------------

export async function handleSiaBatchExecute(
	db: SiaDb,
	input: z.infer<typeof SiaBatchExecuteInput>,
	_embedder: Embedder,
	throttle: ProgressiveThrottle,
	sessionId: string,
	config?: { timeoutPerOp?: number },
): Promise<SiaBatchExecuteResult> {
	const { operations } = input;

	// 1. Enforce batch size cap
	if (operations.length > BATCH_MAX) {
		return {
			results: [],
			eventNodeIds: [],
			contextSavings: 0,
			error: `Batch size ${operations.length} exceeds maximum of ${BATCH_MAX}`,
		};
	}

	const timeoutPerOp = config?.timeoutPerOp ?? DEFAULT_TIMEOUT_MS;
	const results: OperationResult[] = [];
	const eventNodeIds: string[] = [];
	const now = Date.now();
	const nowStr = String(now);

	// 2. Process each operation sequentially
	for (let i = 0; i < operations.length; i++) {
		const op = operations[i];
		let opResult: OperationResult;

		if (op.type === "execute") {
			// Increment throttle counter for this execute op
			await throttle.check(sessionId, "sia_execute");

			const env = buildSandboxEnv(op.env);
			try {
				const subprocess = await executeSubprocess({
					language: op.language,
					code: op.code,
					timeout: op.timeout ?? timeoutPerOp,
					env,
				});
				opResult = {
					index: i,
					type: "execute",
					stdout: subprocess.stdout,
					stderr: subprocess.stderr || undefined,
					exitCode: subprocess.exitCode,
				};
			} catch (err) {
				opResult = {
					index: i,
					type: "execute",
					error: err instanceof Error ? err.message : String(err),
				};
			}
		} else if (op.type === "search") {
			opResult = {
				index: i,
				type: "search",
				error: "Search not yet wired",
			};
		} else {
			opResult = {
				index: i,
				type: (op as { type: string }).type,
				error: "Invalid operation",
			};
		}

		results.push(opResult);

		// 3. Create an EventNode for this operation
		try {
			const nodeId = randomUUID();
			await db.execute(
				`INSERT INTO graph_nodes (id, type, name, summary, content, trust_tier, confidence, base_confidence, importance, base_importance, access_count, edge_count, tags, file_paths, t_created, t_valid_from, created_by, created_at, last_accessed)
			 VALUES (?, 'EventNode', ?, ?, ?, 3, 0.8, 0.8, 0.5, 0.5, 0, 0, '[]', '[]', ?, ?, 'sia-batch-execute', ?, ?)`,
				[
					nodeId,
					`batch-op-${sessionId}-${i}`,
					`Batch operation ${i} (${op.type})`,
					JSON.stringify(opResult),
					nowStr,
					nowStr,
					nowStr,
					nowStr,
				],
			);
			eventNodeIds.push(nodeId);
			if (i > 0 && eventNodeIds[i - 1]) {
				await insertEdge(db, {
					from_id: eventNodeIds[i - 1],
					to_id: nodeId,
					type: "precedes",
					weight: 1.0,
					confidence: 1.0,
					trust_tier: 3,
				});
			}
		} catch (dbErr) {
			// Record failed but execution result is still valid
			console.error("[sia-batch] EventNode creation failed:", (dbErr as Error).message);
		}
	}

	return {
		results,
		eventNodeIds,
		contextSavings: 0,
	};
}
