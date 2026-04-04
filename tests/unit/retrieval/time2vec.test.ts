import { describe, expect, it } from "vitest";
import { createDefaultTime2VecParams, time2vecEncode, type Time2VecParams } from "@/retrieval/time2vec";

describe("Time2Vec encoding", () => {
	const params: Time2VecParams = {
		// 1 linear + 15 periodic = 16 dimensions
		linearWeight: 0.1,
		linearBias: 0.0,
		periodicWeights: new Float32Array(15).fill(1.0),
		periodicBiases: new Float32Array(15).fill(0.0),
	};

	it("produces 16-dimensional output", () => {
		const result = time2vecEncode(1.0, params);
		expect(result.length).toBe(16);
	});

	it("first dimension is linear", () => {
		const result = time2vecEncode(5.0, params);
		// linear: 0.1 * 5.0 + 0.0 = 0.5
		expect(result[0]).toBeCloseTo(0.5);
	});

	it("remaining dimensions are sinusoidal", () => {
		const result = time2vecEncode(0.0, params);
		// sin(1.0 * 0.0 + 0.0) = sin(0) = 0 for all periodic dims
		for (let i = 1; i < 16; i++) {
			expect(result[i]).toBeCloseTo(0.0);
		}
	});

	it("output varies with input time", () => {
		const r1 = time2vecEncode(0.0, params);
		const r2 = time2vecEncode(1.0, params);
		// Should differ in at least the linear component
		expect(r1[0]).not.toBe(r2[0]);
	});

	it("encodes log-scaled days correctly", () => {
		// log2(1 + 30) ≈ 4.95
		const daysSinceCapture = 30;
		const logDays = Math.log2(1 + daysSinceCapture);
		const result = time2vecEncode(logDays, params);
		// Linear component: 0.1 * 4.95 + 0.0 ≈ 0.495
		expect(result[0]).toBeCloseTo(0.495, 2);
	});

	it("createDefaultTime2VecParams returns correct invariants", () => {
		const params = createDefaultTime2VecParams();

		// Linear weight should be negative (recency bias)
		expect(params.linearWeight).toBeLessThan(0);

		// 15 periodic weights
		expect(params.periodicWeights.length).toBe(15);

		// 15 periodic biases
		expect(params.periodicBiases.length).toBe(15);

		// All periodic biases should be zero at bootstrap
		for (let i = 0; i < 15; i++) {
			expect(params.periodicBiases[i]).toBe(0);
		}
	});
});
