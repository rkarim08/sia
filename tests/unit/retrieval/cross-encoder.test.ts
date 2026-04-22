import { describe, expect, it, vi } from "vitest";
import {
	type CrossEncoderCandidate,
	type CrossEncoderReranker,
	createCrossEncoderReranker,
	sigmoid,
} from "@/retrieval/cross-encoder";

describe("CrossEncoderReranker", () => {
	it("reranks candidates by cross-encoder score", async () => {
		// Mock ONNX session that returns deterministic scores
		const mockSession = {
			run: vi.fn().mockImplementation(async (_feeds: Record<string, unknown>) => {
				return {
					logits: {
						data: new Float32Array([0.9]),
						dims: [1, 1],
					},
				};
			}),
		};

		const reranker = createCrossEncoderReranker({
			session: mockSession as any,
			tokenize: (_query: string, _text: string) => ({
				inputIds: new BigInt64Array(128),
				attentionMask: new BigInt64Array(128),
				tokenTypeIds: new BigInt64Array(128),
			}),
			maxSeqLength: 128,
		});

		const candidates: CrossEncoderCandidate[] = [
			{ entityId: "a", text: "first result" },
			{ entityId: "b", text: "second result" },
		];

		const results = await reranker.rerank("test query", candidates);
		expect(results.length).toBe(2);
		expect(results[0]).toHaveProperty("entityId");
		expect(results[0]).toHaveProperty("score");
		// Scores should be numbers in [0, 1] after sigmoid
		expect(results[0].score).toBeGreaterThanOrEqual(0);
		expect(results[0].score).toBeLessThanOrEqual(1);
	});

	it("returns empty array for empty candidates", async () => {
		const reranker = createCrossEncoderReranker({
			session: null,
			tokenize: () => ({
				inputIds: new BigInt64Array(128),
				attentionMask: new BigInt64Array(128),
				tokenTypeIds: new BigInt64Array(128),
			}),
			maxSeqLength: 128,
		});

		const results = await reranker.rerank("query", []);
		expect(results).toEqual([]);
	});

	it("returns candidates with score 0 when session is null", async () => {
		const reranker = createCrossEncoderReranker({
			session: null,
			tokenize: () => ({
				inputIds: new BigInt64Array(128),
				attentionMask: new BigInt64Array(128),
				tokenTypeIds: new BigInt64Array(128),
			}),
			maxSeqLength: 128,
		});

		const results = await reranker.rerank("query", [{ entityId: "a", text: "text" }]);
		expect(results.length).toBe(1);
		expect(results[0].score).toBe(0);
	});

	it("isolates per-candidate errors — failed candidate gets score 0, others scored normally", async () => {
		let callCount = 0;
		const failOn2nd = {
			run: vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 2) throw new Error("GPU out of memory");
				return { logits: { data: new Float32Array([2.0]), dims: [1, 1] } };
			}),
		};

		const reranker = createCrossEncoderReranker({
			session: failOn2nd as any,
			tokenize: () => ({
				inputIds: new BigInt64Array(128),
				attentionMask: new BigInt64Array(128),
				tokenTypeIds: new BigInt64Array(128),
			}),
			maxSeqLength: 128,
		});

		const results = await reranker.rerank("query", [
			{ entityId: "a", text: "first" },
			{ entityId: "b", text: "second" },
			{ entityId: "c", text: "third" },
		]);

		expect(results.length).toBe(3);
		// 2nd candidate (b) should have score 0 due to error
		const bResult = results.find((r) => r.entityId === "b");
		expect(bResult?.score).toBe(0);
		// 1st and 3rd should have proper sigmoid scores
		const aResult = results.find((r) => r.entityId === "a");
		const cResult = results.find((r) => r.entityId === "c");
		expect(aResult!.score).toBeGreaterThan(0);
		expect(cResult!.score).toBeGreaterThan(0);
	});

	it("sigmoid function maps logits to [0, 1]", () => {
		expect(sigmoid(0)).toBeCloseTo(0.5);
		expect(sigmoid(10)).toBeCloseTo(1.0, 2);
		expect(sigmoid(-10)).toBeCloseTo(0.0, 2);
		expect(sigmoid(2)).toBeCloseTo(0.8808, 3);
	});
});
