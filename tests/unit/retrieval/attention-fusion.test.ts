import { describe, expect, it } from "vitest";
import {
	assembleFeatureVector,
	type CandidateFeatures,
	rrfFallback,
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
		graphHopDistance: 2,
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

	it("rrfFallback returns sorted scores matching RRF behavior", () => {
		const candidates: CandidateFeatures[] = [
			{ ...candidate, entityId: "a", bm25Score: 0.9, vectorScore: 0.8, graphScore: 0.7, crossEncoderScore: 0.9 },
			{ ...candidate, entityId: "b", bm25Score: 0.3, vectorScore: 0.2, graphScore: 0.1, crossEncoderScore: 0.3 },
		];

		const results = rrfFallback(candidates);
		expect(results.length).toBe(2);
		expect(results[0].entityId).toBe("a");
		expect(results[0].score).toBeGreaterThan(results[1].score);
	});

	it("rrfFallback returns empty for empty input", () => {
		expect(rrfFallback([])).toEqual([]);
	});
});
