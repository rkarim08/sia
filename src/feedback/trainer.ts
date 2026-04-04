// Module: feedback/trainer — Attention head training pipeline.
// Phase 0 (rrf):          0–499 events — use RRF fallback, no model training
// Phase 1 (distillation): 500–4999 events — use cross-encoder scores as soft labels
// Phase 2 (implicit):     5000–9999 events — use implicit feedback from 3 sources
// Phase 3 (online):       10000+ events — full online learning with IPS debiasing

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SiaDb } from "@/graph/db-interface";
import type { FeedbackEvent } from "@/feedback/types";
import type { ModelManager } from "@/models/manager";

/** Training phase names. */
export type TrainingPhase = "rrf" | "distillation" | "implicit" | "online";

/** Phase thresholds. */
const PHASE_THRESHOLDS = {
	distillation: 500,
	implicit: 5000,
	online: 10000,
} as const;

/**
 * Determine the current training phase based on event count.
 */
export function determineTrainingPhase(eventCount: number): TrainingPhase {
	if (eventCount >= PHASE_THRESHOLDS.online) return "online";
	if (eventCount >= PHASE_THRESHOLDS.implicit) return "implicit";
	if (eventCount >= PHASE_THRESHOLDS.distillation) return "distillation";
	return "rrf";
}

const TRAINING_CHECK_INTERVAL = 50;

/**
 * Determine whether training should be triggered based on event count and phase transitions.
 *
 * Returns false in the "rrf" phase (no training needed).
 * Returns true on phase transition (e.g., rrf → distillation).
 * Returns true if enough new events have accumulated since last training.
 */
export function shouldTrain(
	currentEventCount: number,
	lastTrainedPhase: TrainingPhase | "none",
	lastTrainedEventCount: number,
): boolean {
	const currentPhase = determineTrainingPhase(currentEventCount);
	if (currentPhase === "rrf") return false;
	if (currentPhase !== lastTrainedPhase) return true;
	return (currentEventCount - lastTrainedEventCount) >= TRAINING_CHECK_INTERVAL;
}

/** Training batch: a query paired with candidate entity scores. */
export interface TrainingExample {
	queryText: string;
	candidates: Array<{
		entityId: string;
		features: Float32Array; // 405d feature vector
		targetScore: number;    // Target relevance score (from feedback or distillation)
		ipsWeight: number;      // IPS debiasing weight; 1.0 for Phase 1 distillation (no position bias applied)
	}>;
}

/**
 * Build training examples from feedback events for the distillation phase.
 * Uses cross-encoder scores as soft labels.
 *
 * Note: Feature vectors are zero-initialized here — the Python training script
 * assembles full 405d vectors from the DB export at training time using the
 * entity embeddings and retrieval scores. This function only provides the
 * target scores and grouping structure.
 */
export async function buildDistillationExamples(
	events: FeedbackEvent[],
): Promise<TrainingExample[]> {
	const byQuery = new Map<string, FeedbackEvent[]>();
	for (const event of events) {
		const existing = byQuery.get(event.queryText) ?? [];
		existing.push(event);
		byQuery.set(event.queryText, existing);
	}

	const examples: TrainingExample[] = [];

	for (const [queryText, queryEvents] of byQuery) {
		const candidates = queryEvents.map((event) => ({
			entityId: event.entityId,
			features: new Float32Array(405), // Populated by Python training script from DB
			targetScore: Math.max(0, Math.min(1, (event.signalStrength + 1) / 2)),
			ipsWeight: 1.0,
		}));

		examples.push({ queryText, candidates });
	}

	return examples;
}

/**
 * Compute mean squared error loss between predicted and target scores.
 */
export function mseLoss(predicted: Float32Array, targets: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < predicted.length; i++) {
		const diff = predicted[i] - targets[i];
		sum += diff * diff;
	}
	return sum / predicted.length;
}

/**
 * Simple gradient descent step for the bootstrap attention head weights.
 */
export function gradientDescentStep(
	weights: {
		w1: Float32Array; // [405, 128]
		b1: Float32Array; // [128]
		w2: Float32Array; // [128, 1]
		b2: Float32Array; // [1]
	},
	features: Float32Array,  // [K, 405]
	targets: Float32Array,   // [K]
	learningRate: number,
	K: number,
): number {
	const FEATURE_DIM = 405;
	const HIDDEN_DIM = 128; // Must match create-attention-head.ts

	// Forward pass: hidden_raw = features @ W1
	const hiddenRaw = new Float32Array(K * HIDDEN_DIM);
	for (let k = 0; k < K; k++) {
		for (let h = 0; h < HIDDEN_DIM; h++) {
			let sum = weights.b1[h];
			for (let f = 0; f < FEATURE_DIM; f++) {
				sum += features[k * FEATURE_DIM + f] * weights.w1[f * HIDDEN_DIM + h];
			}
			hiddenRaw[k * HIDDEN_DIM + h] = sum;
		}
	}

	// ReLU
	const hidden = new Float32Array(K * HIDDEN_DIM);
	for (let i = 0; i < hiddenRaw.length; i++) {
		hidden[i] = Math.max(0, hiddenRaw[i]);
	}

	// logits = hidden @ W2 + B2
	const logits = new Float32Array(K);
	for (let k = 0; k < K; k++) {
		let sum = weights.b2[0];
		for (let h = 0; h < HIDDEN_DIM; h++) {
			sum += hidden[k * HIDDEN_DIM + h] * weights.w2[h];
		}
		logits[k] = sum;
	}

	// Sigmoid
	const scores = new Float32Array(K);
	for (let k = 0; k < K; k++) {
		scores[k] = 1 / (1 + Math.exp(-logits[k]));
	}

	const loss = mseLoss(scores, targets);

	// Backward pass
	const dScores = new Float32Array(K);
	for (let k = 0; k < K; k++) {
		dScores[k] = (2 / K) * (scores[k] - targets[k]);
	}

	const dLogits = new Float32Array(K);
	for (let k = 0; k < K; k++) {
		dLogits[k] = dScores[k] * scores[k] * (1 - scores[k]);
	}

	const dW2 = new Float32Array(HIDDEN_DIM);
	for (let h = 0; h < HIDDEN_DIM; h++) {
		let sum = 0;
		for (let k = 0; k < K; k++) {
			sum += hidden[k * HIDDEN_DIM + h] * dLogits[k];
		}
		dW2[h] = sum;
	}

	let dB2 = 0;
	for (let k = 0; k < K; k++) dB2 += dLogits[k];

	const dHidden = new Float32Array(K * HIDDEN_DIM);
	for (let k = 0; k < K; k++) {
		for (let h = 0; h < HIDDEN_DIM; h++) {
			dHidden[k * HIDDEN_DIM + h] = dLogits[k] * weights.w2[h];
		}
	}

	const dHiddenRaw = new Float32Array(K * HIDDEN_DIM);
	for (let i = 0; i < dHidden.length; i++) {
		dHiddenRaw[i] = hiddenRaw[i] > 0 ? dHidden[i] : 0;
	}

	const dW1 = new Float32Array(FEATURE_DIM * HIDDEN_DIM);
	for (let f = 0; f < FEATURE_DIM; f++) {
		for (let h = 0; h < HIDDEN_DIM; h++) {
			let sum = 0;
			for (let k = 0; k < K; k++) {
				sum += features[k * FEATURE_DIM + f] * dHiddenRaw[k * HIDDEN_DIM + h];
			}
			dW1[f * HIDDEN_DIM + h] = sum;
		}
	}

	const dB1 = new Float32Array(HIDDEN_DIM);
	for (let h = 0; h < HIDDEN_DIM; h++) {
		let sum = 0;
		for (let k = 0; k < K; k++) {
			sum += dHiddenRaw[k * HIDDEN_DIM + h];
		}
		dB1[h] = sum;
	}

	// Update weights
	for (let i = 0; i < weights.w1.length; i++) {
		weights.w1[i] -= learningRate * dW1[i];
	}
	for (let i = 0; i < weights.b1.length; i++) {
		weights.b1[i] -= learningRate * dB1[i];
	}
	for (let i = 0; i < weights.w2.length; i++) {
		weights.w2[i] -= learningRate * dW2[i];
	}
	weights.b2[0] -= learningRate * dB2;

	return loss;
}

/**
 * Serialize training examples to JSON for consumption by scripts/train-attention-head.py.
 * Features are stored as regular arrays (Float32Array is not directly JSON-serializable).
 */
export async function exportTrainingData(
	examples: TrainingExample[],
	outputPath: string,
): Promise<void> {
	const payload = {
		version: 1,
		featureDim: 405,
		examples: examples.map((ex) => ({
			queryText: ex.queryText,
			candidates: ex.candidates.map((c) => ({
				entityId: c.entityId,
				features: Array.from(c.features),
				targetScore: c.targetScore,
				ipsWeight: c.ipsWeight,
			})),
		})),
	};
	try {
		writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
	} catch (err) {
		throw new Error(
			`Failed to export training data to ${outputPath}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * Invoke the Python training script via Bun.spawn.
 */
export async function runPythonTraining(
	dataPath: string,
	outputPath: string,
	phase: TrainingPhase,
): Promise<void> {
	const scriptPath = join(dirname(new URL(import.meta.url).pathname), "../../scripts/train-attention-head.py");

	const proc = Bun.spawn(
		["python", scriptPath,
		 "--data-path", dataPath,
		 "--output", outputPath,
		 "--phase", phase,
		 "--hidden-dim", "64",
		 "--num-heads", "4",
		 "--key-dim", "16",
		 "--ffn-dim", "128",
		 "--dropout", "0.1",
		 "--weight-decay", "1e-4",
		 "--opset", "17",
		],
		{ stdout: "pipe", stderr: "pipe" },
	);

	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`Training script failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
	}
}

/** Dependencies for the training orchestration. */
export interface TrainerDeps {
	db: { execute: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
	modelManager: ModelManager;
	trainingDataDir: string;
}

/**
 * Full training orchestration:
 * 1. Read feedback events from DB
 * 2. Determine training phase and check real-event gate (≥50 real events to activate head)
 * 3. Export training data to JSON
 * 4. Invoke Python training script via Bun.spawn
 * 5. Update manifest (trainingPhase, feedbackEvents, lastTrained)
 */
export async function trainAttentionHead(
	db: { execute: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
	modelManager: ModelManager,
	trainingDataDir: string,
): Promise<void> {
	const totalResult = await db.execute("SELECT COUNT(*) as cnt FROM feedback_events");
	const totalEvents = (totalResult.rows[0] as { cnt: number })?.cnt ?? 0;

	const phase = determineTrainingPhase(totalEvents);
	if (phase === "rrf") return; // No training in RRF phase

	// Check real-event gate: Stage 4 must not activate on synthetic-only data
	const realResult = await db.execute(
		"SELECT COUNT(*) as cnt FROM feedback_events WHERE source != 'synthetic'",
	);
	const realEvents = (realResult.rows[0] as { cnt: number })?.cnt ?? 0;
	const REAL_EVENT_GATE = 50;
	const headShouldActivate = realEvents >= REAL_EVENT_GATE;

	// Enforce gate: do not train on synthetic-only data
	if (!headShouldActivate) {
		return;
	}

	const dataPath = join(trainingDataDir, "training_data.json");
	const outputPath = modelManager.getModelPath("sia-attention-head", "model.onnx");

	// Export raw event data for Python script
	const eventsResult = await db.execute(
		"SELECT * FROM feedback_events ORDER BY timestamp DESC LIMIT 10000",
	);
	const rawExport = {
		version: 1,
		events: eventsResult.rows,
		realEventGatePassed: headShouldActivate,
	};

	try {
		writeFileSync(dataPath, JSON.stringify(rawExport, null, 2), "utf8");
	} catch (err) {
		throw new Error(
			`Failed to write training data to ${dataPath}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Run Python training
	await runPythonTraining(dataPath, outputPath, phase);

	// Update manifest with new training state
	modelManager.updateAttentionHeadMeta({
		trainingPhase: phase,
		feedbackEvents: totalEvents,
		lastTrained: new Date().toISOString(),
	});
}
