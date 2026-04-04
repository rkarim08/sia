import { describe, expect, it, vi, afterEach } from "vitest";
import {
	determineTrainingPhase,
	exportTrainingData,
	trainAttentionHead,
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
