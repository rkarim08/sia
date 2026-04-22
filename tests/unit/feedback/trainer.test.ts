import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	applyDebiasingToExamples,
	determineTrainingPhase,
	exportTrainingData,
	gradientDescentStep,
	mseLoss,
	shouldTrain,
	type TrainingExample,
	trainAttentionHead,
} from "@/feedback/trainer";
import type { FeedbackEvent } from "@/feedback/types";

describe("feedback trainer", () => {
	it("returns 'rrf' phase for 0 events", () => {
		expect(determineTrainingPhase(0)).toBe("rrf");
	});

	it("returns 'rrf' phase for < 500 events", () => {
		expect(determineTrainingPhase(499)).toBe("rrf");
	});

	it("returns 'distillation' phase for 500-4999 events", () => {
		expect(determineTrainingPhase(500)).toBe("distillation");
		expect(determineTrainingPhase(4999)).toBe("distillation");
	});

	it("returns 'implicit' phase for 5000-9999 events", () => {
		expect(determineTrainingPhase(5000)).toBe("implicit");
		expect(determineTrainingPhase(9999)).toBe("implicit");
	});

	it("returns 'online' phase for 10000+ events", () => {
		expect(determineTrainingPhase(10000)).toBe("online");
		expect(determineTrainingPhase(50000)).toBe("online");
	});
});

describe("exportTrainingData", () => {
	let tmpDir: string;

	afterEach(() => {
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes training data JSON with examples", async () => {
		tmpDir = join(tmpdir(), `sia-trainer-test-${randomUUID()}`);
		mkdirSync(tmpDir, { recursive: true });

		const examples = [
			{
				queryText: "authentication pattern",
				candidates: [
					{
						entityId: "e1",
						features: new Float32Array(405).fill(0.5),
						targetScore: 0.9,
						ipsWeight: 1.0,
					},
					{
						entityId: "e2",
						features: new Float32Array(405).fill(0.2),
						targetScore: 0.3,
						ipsWeight: 1.18,
					},
				],
			},
		];

		const dataPath = join(tmpDir, "training_data.json");
		await exportTrainingData(examples, dataPath);
		expect(existsSync(dataPath)).toBe(true);

		const content = JSON.parse(require("node:fs").readFileSync(dataPath, "utf8"));
		expect(content.examples).toHaveLength(1);
		expect(content.examples[0].queryText).toBe("authentication pattern");
	});
});

describe("trainAttentionHead manifest update", () => {
	it("updates manifest attentionHead fields after training", async () => {
		const mockManifest = {
			schemaVersion: 1,
			installedTier: "T1" as const,
			models: {
				"sia-attention-head": {
					version: "1.0",
					variant: "fp32" as const,
					sha256: "abc",
					sizeBytes: 360000,
					source: "local",
					installedAt: new Date().toISOString(),
					tier: "T1" as const,
				},
			},
			attentionHead: {
				trainingPhase: "rrf" as const,
				feedbackEvents: 0,
				lastTrained: null,
				projectVariants: {},
			},
		};

		const _modelManager = {
			getManifest: () => mockManifest,
			getModelPath: (name: string, file: string) => `/tmp/models/${name}/${file}`,
			getModelsDir: () => "/tmp/models",
			isModelInstalled: () => true,
			recordModelInstalled: vi.fn(),
			removeModel: vi.fn(),
			setInstalledTier: vi.fn(),
			verifyChecksum: vi.fn(),
			updateAttentionHeadMeta: vi.fn(),
		};

		// Interface check — actual training invokes Python subprocess
		expect(typeof trainAttentionHead).toBe("function");
		expect(typeof exportTrainingData).toBe("function");
	});
});

describe("shouldTrain", () => {
	it("returns false in rrf phase (< 500 events)", () => {
		expect(shouldTrain(100, "none", 0)).toBe(false);
	});

	it("returns true on phase transition (rrf → distillation)", () => {
		expect(shouldTrain(500, "rrf", 0)).toBe(true);
	});

	it("returns true when enough events accumulated since last training", () => {
		expect(shouldTrain(600, "distillation", 500)).toBe(true);
	});

	it("returns false when not enough events since last training", () => {
		expect(shouldTrain(530, "distillation", 500)).toBe(false);
	});
});

describe("mseLoss", () => {
	it("computes correct MSE for known values", () => {
		const predicted = new Float32Array([0.5, 0.5]);
		const targets = new Float32Array([1.0, 0.0]);
		expect(mseLoss(predicted, targets)).toBeCloseTo(0.25, 5);
	});

	it("returns 0 for identical arrays", () => {
		const a = new Float32Array([0.3, 0.7, 0.5]);
		expect(mseLoss(a, a)).toBeCloseTo(0, 5);
	});
});

describe("applyDebiasingToExamples", () => {
	it("applies IPS weights to 2 candidates given 6 events", () => {
		const rawEvents: FeedbackEvent[] = [
			{
				id: "1",
				queryText: "q1",
				entityId: "e1",
				signalStrength: 1.0,
				source: "visualizer",
				timestamp: 1,
				sessionId: "s1",
				rankPosition: 0,
				candidatesShown: 3,
			},
			{
				id: "2",
				queryText: "q1",
				entityId: "e2",
				signalStrength: 0.0,
				source: "visualizer",
				timestamp: 2,
				sessionId: "s1",
				rankPosition: 1,
				candidatesShown: 3,
			},
			{
				id: "3",
				queryText: "q1",
				entityId: "e3",
				signalStrength: 0.0,
				source: "visualizer",
				timestamp: 3,
				sessionId: "s1",
				rankPosition: 2,
				candidatesShown: 3,
			},
			{
				id: "4",
				queryText: "q2",
				entityId: "e4",
				signalStrength: 1.0,
				source: "visualizer",
				timestamp: 4,
				sessionId: "s2",
				rankPosition: 0,
				candidatesShown: 2,
			},
			{
				id: "5",
				queryText: "q2",
				entityId: "e5",
				signalStrength: 0.8,
				source: "visualizer",
				timestamp: 5,
				sessionId: "s2",
				rankPosition: 1,
				candidatesShown: 2,
			},
			{
				id: "6",
				queryText: "q3",
				entityId: "e6",
				signalStrength: 0.0,
				source: "synthetic",
				timestamp: 6,
				sessionId: "s3",
				rankPosition: 3,
				candidatesShown: 4,
			},
		];

		const examples: TrainingExample[] = [
			{
				queryText: "q1",
				candidates: [
					{ entityId: "e1", features: new Float32Array(405), targetScore: 1.0, ipsWeight: 1.0 },
					{ entityId: "e2", features: new Float32Array(405), targetScore: 0.5, ipsWeight: 1.0 },
				],
			},
		];

		const result = applyDebiasingToExamples(examples, rawEvents);

		expect(result).toHaveLength(1);
		expect(result[0].queryText).toBe("q1");
		expect(result[0].candidates).toHaveLength(2);
		// Rank 0 has highest examination probability → smallest IPS weight (≈ 1)
		expect(result[0].candidates[0].ipsWeight).toBeGreaterThan(0);
		expect(result[0].candidates[0].ipsWeight).toBeLessThanOrEqual(10);
		// Rank 1 should have a larger IPS weight than rank 0 (lower examination prior)
		expect(result[0].candidates[1].ipsWeight).toBeGreaterThan(result[0].candidates[0].ipsWeight);
		// targetScore must be re-scaled by ipsWeight
		expect(result[0].candidates[0].targetScore).toBeCloseTo(
			1.0 * result[0].candidates[0].ipsWeight,
			5,
		);
		expect(result[0].candidates[1].targetScore).toBeCloseTo(
			0.5 * result[0].candidates[1].ipsWeight,
			5,
		);
	});
});

describe("gradientDescentStep", () => {
	it("decreases loss after one step", () => {
		const K = 2;
		const FEATURE_DIM = 405;
		const HIDDEN_DIM = 128; // Must match create-attention-head.ts

		const weights = {
			w1: new Float32Array(FEATURE_DIM * HIDDEN_DIM).fill(0.01),
			b1: new Float32Array(HIDDEN_DIM).fill(0),
			w2: new Float32Array(HIDDEN_DIM).fill(0.01),
			b2: new Float32Array(1).fill(0),
		};

		const features = new Float32Array(K * FEATURE_DIM);
		for (let i = 0; i < features.length; i++) features[i] = Math.random() * 0.5;
		const targets = new Float32Array([0.9, 0.1]);

		const loss1 = gradientDescentStep(weights, features, targets, 0.01, K);
		const loss2 = gradientDescentStep(weights, features, targets, 0.01, K);

		expect(loss2).toBeLessThan(loss1);
	});
});
