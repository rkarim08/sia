import { describe, expect, it } from "vitest";
import { getModelsForTier, MODEL_REGISTRY } from "@/models/registry";

describe("model registry", () => {
	it("T0 includes bge-small and ms-marco-MiniLM", () => {
		const t0 = getModelsForTier("T0");
		expect(t0).toHaveProperty("bge-small-en-v1.5");
		expect(t0).toHaveProperty("ms-marco-MiniLM-L-6-v2");
		expect(Object.keys(t0).length).toBe(2);
	});

	it("T1 includes T0 models plus jina-code, nomic, and attention head", () => {
		const t1 = getModelsForTier("T1");
		expect(t1).toHaveProperty("bge-small-en-v1.5");
		expect(t1).toHaveProperty("ms-marco-MiniLM-L-6-v2");
		expect(t1).toHaveProperty("jina-embeddings-v2-base-code");
		expect(t1).toHaveProperty("nomic-embed-text-v1.5");
		expect(t1).toHaveProperty("sia-attention-head");
	});

	it("T2 includes T1 models plus gliner", () => {
		const t2 = getModelsForTier("T2");
		expect(t2).toHaveProperty("gliner-small-v2.1");
	});

	it("T3 includes T2 models plus mxbai-rerank", () => {
		const t3 = getModelsForTier("T3");
		expect(t3).toHaveProperty("mxbai-rerank-base-v1");
	});

	it("every registry entry has required fields", () => {
		for (const [name, entry] of Object.entries(MODEL_REGISTRY)) {
			expect(entry.huggingface, `${name} missing huggingface`).toBeTruthy();
			expect(entry.file, `${name} missing file`).toBeTruthy();
			expect(entry.sha256, `${name} missing sha256`).toBeTruthy();
			expect(entry.sizeBytes, `${name} missing sizeBytes`).toBeGreaterThan(0);
			expect(entry.tier, `${name} missing tier`).toBeTruthy();
		}
	});
});
