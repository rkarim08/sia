// Module: nous/surprise-router — PostToolUse prediction-error routing
//
// Fires on PostToolUse. For each tool response that carries both a predictable
// shape (e.g. the command or query the model issued) and an observable outcome
// (e.g. stdout's first line, or the top Grep hit), we score the (prediction,
// observation) pair via the transformer-stack cross-encoder. A low score ⇒
// high prediction error ⇒ surprise. When surprise > SURPRISE_THRESHOLD we
// write a `Signal` node named `surprise:<kind>`, append a `surprise` history
// row, and bump the session's `surpriseCount`.
//
// Guarantees:
// - Fail-open: if the cross-encoder model is not downloaded (T0 tier without
//   the MiniLM cross-encoder installed yet), we return a no-surprise result.
//   Surprise detection is a quality signal, not a correctness gate.
// - Latency-bounded: the cross-encoder call is wrapped in a 150ms timeout so
//   that the hook stays well within its 200ms budget. Timeouts are treated
//   as "insufficient evidence" — they do NOT fire a signal.
// - Tool-aware: only tools whose inputs have a prediction worth checking are
//   scored. Write/Edit are skipped entirely (no prediction, just an effect).

import { existsSync, readFileSync } from "node:fs";
import { v4 as uuid } from "uuid";
import { tokenizePair } from "@/capture/pair-tokenizer";
import type { SiaDb } from "@/graph/db-interface";
import type { HookEvent } from "@/hooks/types";
import { createModelManager } from "@/models/manager";
import {
	type CrossEncoderReranker,
	createCrossEncoderReranker,
	DEFAULT_CE_MODEL,
} from "@/retrieval/cross-encoder";
import { SIA_HOME } from "@/shared/config";
import { DEFAULT_NOUS_CONFIG, type NousConfig } from "./types";
import { appendHistory, getSession, updateSessionState } from "./working-memory";

/** Score threshold: cross-encoder scores below this are treated as surprising. */
export const SURPRISE_THRESHOLD = 0.7;

/** Maximum time the cross-encoder may take before we abort and emit no signal. */
export const SURPRISE_CE_TIMEOUT_MS = 150;

/** Kind tags written into `name: surprise:<kind>` for downstream filtering. */
export type SurpriseKind = "bash" | "grep" | "glob";

export interface SurpriseResult {
	surpriseDetected: boolean;
	signalNodeId?: string;
	/** Raw cross-encoder similarity in [0, 1]. `null` when scoring was skipped. */
	score: number | null;
	/** Short explanation why the router skipped scoring (null when it scored). */
	skippedReason:
		| null
		| "disabled"
		| "no-session"
		| "unsupported-tool"
		| "no-prediction"
		| "no-observation"
		| "no-reranker"
		| "timeout"
		| "error";
}

export interface SurpriseRouterOptions {
	/**
	 * Inject a reranker (tests / DI). When omitted, the router lazily loads
	 * the installed MiniLM cross-encoder from the global model manifest. If
	 * that load fails for any reason, the router fails open.
	 */
	reranker?: CrossEncoderReranker | null;
	/** Override the timeout (ms). Defaults to SURPRISE_CE_TIMEOUT_MS. */
	timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Lazy, process-wide reranker cache
// ---------------------------------------------------------------------------

let cachedRerankerPromise: Promise<CrossEncoderReranker | null> | null = null;

/**
 * Reset the lazy reranker cache. Intended for tests — each test can force a
 * fresh load path without interference from prior suites.
 */
export function __resetSurpriseRouterForTests(): void {
	cachedRerankerPromise = null;
}

async function loadCrossEncoderLazy(): Promise<CrossEncoderReranker | null> {
	if (cachedRerankerPromise) return cachedRerankerPromise;
	cachedRerankerPromise = (async () => {
		try {
			const manager = createModelManager(SIA_HOME);
			if (!manager.isModelInstalled(DEFAULT_CE_MODEL)) {
				// Model not downloaded — fail open. No stderr noise, this is the
				// expected T0 state before first model sync.
				return null;
			}

			// Lazy-load onnxruntime-node. Wrapped in try so an air-gapped or
			// unsupported platform (missing prebuilds) does not throw.
			let ort: typeof import("onnxruntime-node");
			try {
				ort = await import("onnxruntime-node");
			} catch (err) {
				process.stderr.write(
					`[Nous] surprise-router: onnxruntime-node unavailable (${err instanceof Error ? err.message : String(err)}) — fail open\n`,
				);
				return null;
			}

			const modelPath = manager.getModelPath(DEFAULT_CE_MODEL, "onnx/model_quantized.onnx");
			const tokenizerPath = manager.getModelPath(DEFAULT_CE_MODEL, "tokenizer.json");
			if (!existsSync(modelPath) || !existsSync(tokenizerPath)) {
				process.stderr.write(
					`[Nous] surprise-router: ${DEFAULT_CE_MODEL} files missing on disk — fail open\n`,
				);
				return null;
			}

			const session = (await ort.InferenceSession.create(modelPath, {
				executionProviders: ["cpu"],
			})) as unknown as import("@/models/types").OnnxSession;

			const vocab = loadVocabForCE(tokenizerPath);
			if (!vocab) {
				process.stderr.write(
					`[Nous] surprise-router: failed to load vocab for ${DEFAULT_CE_MODEL} — fail open\n`,
				);
				return null;
			}

			const maxSeqLength = 256;
			return createCrossEncoderReranker({
				session,
				tokenize: (query, text) => tokenizePair(vocab, query, text, maxSeqLength),
				maxSeqLength,
				modelName: DEFAULT_CE_MODEL,
			});
		} catch (err) {
			process.stderr.write(
				`[Nous] surprise-router: cross-encoder load failed (${err instanceof Error ? err.message : String(err)}) — fail open\n`,
			);
			return null;
		}
	})();
	return cachedRerankerPromise;
}

function loadVocabForCE(tokenizerJsonPath: string): Map<string, number> | null {
	try {
		const parsed = JSON.parse(readFileSync(tokenizerJsonPath, "utf-8"));
		const modelVocab = parsed?.model?.vocab;
		if (!modelVocab || typeof modelVocab !== "object") return null;
		const m = new Map<string, number>();
		for (const [token, id] of Object.entries(modelVocab)) {
			if (typeof id === "number") m.set(token, id);
		}
		return m;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Tool-specific (prediction, observation) extraction
// ---------------------------------------------------------------------------

interface SurpriseProbe {
	kind: SurpriseKind;
	prediction: string;
	observation: string;
}

function extractProbe(
	toolName: string | undefined,
	toolInput: Record<string, unknown> | undefined,
	toolResponse: unknown,
): SurpriseProbe | { skipped: SurpriseResult["skippedReason"] } {
	if (!toolName) return { skipped: "unsupported-tool" };

	// Write/Edit: outputs, not predictions. The tool_response is the effect
	// the model committed to — there is no separate observation to compare.
	if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
		return { skipped: "unsupported-tool" };
	}

	if (toolName === "Bash") {
		const command = typeof toolInput?.command === "string" ? toolInput.command : "";
		if (!command) return { skipped: "no-prediction" };
		const outputText = extractBashOutput(toolResponse);
		if (!outputText) return { skipped: "no-observation" };
		const firstLine = outputText.split(/\r?\n/, 1)[0]?.trim() ?? "";
		if (!firstLine) return { skipped: "no-observation" };
		return { kind: "bash", prediction: command, observation: firstLine };
	}

	if (toolName === "Grep") {
		const pattern = typeof toolInput?.pattern === "string" ? toolInput.pattern : "";
		if (!pattern) return { skipped: "no-prediction" };
		const topHit = extractTopHit(toolResponse);
		if (!topHit) return { skipped: "no-observation" };
		return { kind: "grep", prediction: pattern, observation: topHit };
	}

	if (toolName === "Glob") {
		const pattern = typeof toolInput?.pattern === "string" ? toolInput.pattern : "";
		if (!pattern) return { skipped: "no-prediction" };
		const topHit = extractTopHit(toolResponse);
		if (!topHit) return { skipped: "no-observation" };
		return { kind: "glob", prediction: pattern, observation: topHit };
	}

	return { skipped: "unsupported-tool" };
}

function extractBashOutput(toolResponse: unknown): string {
	if (typeof toolResponse === "string") return toolResponse;
	if (toolResponse && typeof toolResponse === "object") {
		const obj = toolResponse as Record<string, unknown>;
		if (typeof obj.output === "string") return obj.output;
		if (typeof obj.stdout === "string") return obj.stdout;
	}
	return "";
}

function extractTopHit(toolResponse: unknown): string {
	if (typeof toolResponse === "string") {
		const first = toolResponse.split(/\r?\n/, 1)[0]?.trim() ?? "";
		return first;
	}
	if (toolResponse && typeof toolResponse === "object") {
		const obj = toolResponse as Record<string, unknown>;
		if (Array.isArray(obj.filenames) && obj.filenames.length > 0) {
			const first = obj.filenames[0];
			return typeof first === "string" ? first : String(first ?? "");
		}
		if (Array.isArray(obj.matches) && obj.matches.length > 0) {
			const first = obj.matches[0];
			if (typeof first === "string") return first;
			if (first && typeof first === "object") {
				const f = first as Record<string, unknown>;
				const line = typeof f.line === "string" ? f.line : undefined;
				const path = typeof f.path === "string" ? f.path : undefined;
				return line ?? path ?? JSON.stringify(first);
			}
		}
		if (typeof obj.output === "string") {
			const first = obj.output.split(/\r?\n/, 1)[0]?.trim() ?? "";
			return first;
		}
	}
	return "";
}

// ---------------------------------------------------------------------------
// Core entry point
// ---------------------------------------------------------------------------

export async function runSurpriseRouter(
	db: SiaDb,
	event: Pick<HookEvent, "session_id" | "tool_name" | "tool_input" | "tool_response">,
	config: NousConfig = DEFAULT_NOUS_CONFIG,
	opts: SurpriseRouterOptions = {},
): Promise<SurpriseResult> {
	if (!config.enabled) {
		return { surpriseDetected: false, score: null, skippedReason: "disabled" };
	}
	if (!event.session_id) {
		return { surpriseDetected: false, score: null, skippedReason: "no-session" };
	}

	const session = getSession(db, event.session_id);
	if (!session) {
		return { surpriseDetected: false, score: null, skippedReason: "no-session" };
	}

	const probe = extractProbe(event.tool_name, event.tool_input, event.tool_response);
	if ("skipped" in probe) {
		return { surpriseDetected: false, score: null, skippedReason: probe.skipped };
	}

	const reranker = opts.reranker === undefined ? await loadCrossEncoderLazy() : opts.reranker;
	if (!reranker) {
		return { surpriseDetected: false, score: null, skippedReason: "no-reranker" };
	}

	const timeoutMs = opts.timeoutMs ?? SURPRISE_CE_TIMEOUT_MS;
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<"__timeout__">((resolve) => {
		timeoutHandle = setTimeout(() => resolve("__timeout__"), timeoutMs);
		if (timeoutHandle && typeof (timeoutHandle as NodeJS.Timeout).unref === "function") {
			(timeoutHandle as NodeJS.Timeout).unref();
		}
	});

	let score: number;
	try {
		const raced = await Promise.race([
			reranker.rerank(probe.prediction, [{ entityId: "probe", text: probe.observation }]),
			timeoutPromise,
		]);
		if (raced === "__timeout__") {
			process.stderr.write(
				`[Nous] surprise-router: cross-encoder exceeded ${timeoutMs}ms — skipping\n`,
			);
			return { surpriseDetected: false, score: null, skippedReason: "timeout" };
		}
		score = raced[0]?.score ?? 0;
	} catch (err) {
		process.stderr.write(
			`[Nous] surprise-router: cross-encoder error (${err instanceof Error ? err.message : String(err)}) — fail open\n`,
		);
		return { surpriseDetected: false, score: null, skippedReason: "error" };
	} finally {
		if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
	}

	// Low similarity = high surprise. Fire when score is below threshold.
	const surpriseMagnitude = 1 - score;
	const fired = surpriseMagnitude > SURPRISE_THRESHOLD;

	const nowSec = Math.floor(Date.now() / 1000);
	appendHistory(db, {
		session_id: event.session_id,
		event_type: "surprise",
		score: surpriseMagnitude,
		created_at: nowSec,
	});

	if (!fired) {
		return { surpriseDetected: false, score, skippedReason: null };
	}

	updateSessionState(db, event.session_id, {
		...session.state,
		surpriseCount: session.state.surpriseCount + 1,
	});

	const signalNodeId = writeSignalNode(
		db,
		event.session_id,
		session.session_type,
		probe.kind,
		surpriseMagnitude,
		probe.prediction,
		probe.observation,
	);

	return { surpriseDetected: true, score, signalNodeId, skippedReason: null };
}

function writeSignalNode(
	db: SiaDb,
	sessionId: string,
	sessionType: string,
	kind: SurpriseKind,
	magnitude: number,
	prediction: string,
	observation: string,
): string {
	const raw = db.rawSqlite();
	if (!raw) return "";
	const id = uuid();
	const now = Date.now();
	const trimmedPrediction = prediction.slice(0, 200);
	const trimmedObservation = observation.slice(0, 200);

	raw
		.prepare(
			`INSERT INTO graph_nodes (
				id, type, name, content, summary,
				tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance,
				access_count, edge_count,
				last_accessed, created_at, t_created,
				visibility, created_by,
				kind,
				captured_by_session_id, captured_by_session_type
			) VALUES (
				?, 'Signal', ?, ?, ?,
				'[]', '[]',
				2, ?, ?,
				0.5, 0.5,
				0, 0,
				?, ?, ?,
				'private', 'nous',
				'Signal',
				?, ?
			)`,
		)
		.run(
			id,
			`surprise:${kind}`,
			`Surprise (${kind}) in session ${sessionId}: magnitude ${magnitude.toFixed(2)}\n\nPrediction: ${trimmedPrediction}\nObservation: ${trimmedObservation}`,
			`Surprise magnitude ${magnitude.toFixed(2)} — ${kind} prediction error`,
			magnitude,
			magnitude,
			now,
			now,
			now,
			sessionId,
			sessionType,
		);

	return id;
}
