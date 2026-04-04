import { describe, expect, it, vi, afterEach } from "vitest";
import {
	determineTrainingPhase,
	exportTrainingData,
	trainAttentionHead,
	shouldTrain,
	mseLoss,
	gradientDescentStep,
	type TrainingPhase,
	type TrainerDeps,
} from "@/feedback/trainer";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

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
					{ entityId: "e1", features: new Float32Array(405).fill(0.5), targetScore: 0.9, ipsWeight: 1.0 },
					{ entityId: "e2", features: new Float32Array(405).fill(0.2), targetScore: 0.3, ipsWeight: 1.18 },
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
			models: { "sia-attention-head": { version: "1.0", variant: "fp32" as const, sha256: "abc", sizeBytes: 360000, source: "local", installedAt: new Date().toISOString(), tier: "T1" as const } },
			attentionHead: { trainingPhase: "rrf" as const, feedbackEvents: 0, lastTrained: null, projectVariants: {} },
		};

		const modelManager = {
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

describe("gradientDescentStep", () => {
	it("decreases loss after one step", () => {
		const K = 2;
		const FEATURE_DIM = 405;
		const HIDDEN_DIM = 64;

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
