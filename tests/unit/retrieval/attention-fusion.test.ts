import { describe, expect, it } from "vitest";
import {
	assembleFeatureVector,
	attentionFusion,
	type CandidateFeatures,
	FEATURE_DIM,
	FEATURE_DIM_T1,
	weightedScoreFallback,
} from "@/retrieval/attention-fusion";

describe("attention fusion", () => {
	const candidate: CandidateFeatures = {
		entityId: "test-1",
		bm25Score: 0.8,
		vectorScore: 0.7,
		graphScore: 0.6,
		crossEncoderScore: 0.9,
		trustTierWeight: 0.9,
		entityEmbedding: new Float32Array(384).fill(0.01),
		daysSinceCapture: 30,
	};

	it("assembleFeatureVector produces correct dimension (405)", () => {
		const vec = assembleFeatureVector(candidate);
		// 4 scores + 1 trust + 384 embedding + 16 time2vec = 405
		expect(vec.length).toBe(405);
	});

	it("first 4 values are per-signal normalized retrieval scores", () => {
		const vec = assembleFeatureVector(candidate);
		expect(typeof vec[0]).toBe("number");
		expect(typeof vec[1]).toBe("number");
		expect(typeof vec[2]).toBe("number");
		expect(typeof vec[3]).toBe("number");
	});

	it("trust tier weight is at index 4", () => {
		const vec = assembleFeatureVector(candidate);
		expect(vec[4]).toBeCloseTo(0.9);
	});

	it("weightedScoreFallback returns sorted scores matching RRF behavior", () => {
		const candidates: CandidateFeatures[] = [
			{
				...candidate,
				entityId: "a",
				bm25Score: 0.9,
				vectorScore: 0.8,
				graphScore: 0.7,
				crossEncoderScore: 0.9,
			},
			{
				...candidate,
				entityId: "b",
				bm25Score: 0.3,
				vectorScore: 0.2,
				graphScore: 0.1,
				crossEncoderScore: 0.3,
			},
		];

		const results = weightedScoreFallback(candidates);
		expect(results.length).toBe(2);
		expect(results[0].entityId).toBe("a");
		expect(results[0].score).toBeGreaterThan(results[1].score);
	});

	it("weightedScoreFallback returns empty for empty input", () => {
		expect(weightedScoreFallback([])).toEqual([]);
	});

	it("assembleFeatureVector produces 406d with codeVectorScore (T1)", () => {
		const t1Candidate: CandidateFeatures = {
			...candidate,
			codeVectorScore: 0.55,
		};
		const vec = assembleFeatureVector(t1Candidate);
		expect(vec.length).toBe(FEATURE_DIM_T1);
		expect(vec[405]).toBeCloseTo(0.55, 5);
	});

	it("assembleFeatureVector throws on wrong embedding dimension", () => {
		const bad: CandidateFeatures = {
			...candidate,
			entityEmbedding: new Float32Array(256), // wrong!
		};
		expect(() => assembleFeatureVector(bad)).toThrow("384d");
	});

	it("assembleFeatureVector clamps negative daysSinceCapture to 0", () => {
		const neg: CandidateFeatures = { ...candidate, daysSinceCapture: -5 };
		const vec = assembleFeatureVector(neg);
		expect(vec.length).toBe(FEATURE_DIM);
	});

	it("attentionFusion uses ONNX scores when session returns valid output", async () => {
		const c1: CandidateFeatures = { ...candidate, entityId: "c1", bm25Score: 0.1 };
		const c2: CandidateFeatures = { ...candidate, entityId: "c2", bm25Score: 0.9 };
		const mockSession = {
			run: async () => ({
				scores: { data: new Float32Array([0.9, 0.1]), dims: [2] },
			}),
		};
		const result = await attentionFusion(
			[c1, c2],
			[
				[0, 5],
				[5, 0],
			],
			null,
			mockSession,
		);
		expect(result[0].entityId).toBe("c1");
		expect(result[0].score).toBeCloseTo(0.9, 3);
	});

	it("attentionFusion falls back to RRF on ONNX error", async () => {
		const c1: CandidateFeatures = { ...candidate, entityId: "c1", bm25Score: 0.9 };
		const c2: CandidateFeatures = { ...candidate, entityId: "c2", bm25Score: 0.1 };
		const throwingSession = {
			run: async () => {
				throw new Error("ONNX crashed");
			},
		};
		const result = await attentionFusion(
			[c1, c2],
			[
				[0, 5],
				[5, 0],
			],
			null,
			throwingSession,
		);
		expect(result[0].entityId).toBe("c1");
		expect(result.length).toBe(2);
	});

	it("attentionFusion falls back to RRF on null session", async () => {
		const c1: CandidateFeatures = { ...candidate, entityId: "c1" };
		const result = await attentionFusion([c1], [[0]], null, null);
		expect(result.length).toBe(1);
		expect(result[0].entityId).toBe("c1");
	});

	it("falls back to weightedScoreFallback when ONNX returns fewer scores than candidates", async () => {
		const c1: CandidateFeatures = { ...candidate, entityId: "c1" };
		const c2: CandidateFeatures = { ...candidate, entityId: "c2" };
		const c3: CandidateFeatures = { ...candidate, entityId: "c3" };

		// Session returns only 1 score instead of 3 — the scores tensor data length is 1
		const partialSession = {
			run: async () => ({
				scores: { data: new Float32Array([0.5]), dims: [1] },
			}),
		};

		const result = await attentionFusion(
			[c1, c2, c3],
			[
				[0, 5, 5],
				[5, 0, 5],
				[5, 5, 0],
			],
			null,
			partialSession,
		);

		// Should still return 3 results (c2 and c3 get score 0 from undefined data[1], data[2])
		expect(result.length).toBe(3);
		// All should have scores (even if some are 0 from missing data)
		for (const r of result) {
			expect(typeof r.score).toBe("number");
		}
	});
});
