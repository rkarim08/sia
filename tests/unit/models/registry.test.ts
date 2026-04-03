import { describe, expect, it } from "vitest";
import { getModelsForTier, getModelsToDownload, getModelsToRemove, MODEL_REGISTRY } from "@/models/registry";

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

	it("getModelsToDownload T0→T1 returns exactly jina-code, nomic, attention-head", () => {
		const toDownload = getModelsToDownload("T0", "T1");
		const names = Object.keys(toDownload);
		expect(names).toContain("jina-embeddings-v2-base-code");
		expect(names).toContain("nomic-embed-text-v1.5");
		expect(names).toContain("sia-attention-head");
		expect(names).not.toContain("bge-small-en-v1.5");
		expect(names).not.toContain("gliner-small-v2.1");
	});

	it("getModelsToDownload same tier returns empty", () => {
		const toDownload = getModelsToDownload("T1", "T1");
		expect(Object.keys(toDownload).length).toBe(0);
	});

	it("getModelsToDownload downgrade returns empty", () => {
		const toDownload = getModelsToDownload("T3", "T1");
		expect(Object.keys(toDownload).length).toBe(0);
	});

	it("getModelsToRemove T3→T1 returns gliner and mxbai", () => {
		const toRemove = getModelsToRemove("T3", "T1");
		expect(toRemove).toContain("gliner-small-v2.1");
		expect(toRemove).toContain("mxbai-rerank-base-v1");
		expect(toRemove).not.toContain("bge-small-en-v1.5");
		expect(toRemove).not.toContain("jina-embeddings-v2-base-code");
	});

	it("getModelsToRemove same tier returns empty", () => {
		const toRemove = getModelsToRemove("T1", "T1");
		expect(toRemove.length).toBe(0);
	});

	it("getModelsToRemove upgrade returns empty", () => {
		const toRemove = getModelsToRemove("T1", "T3");
		expect(toRemove.length).toBe(0);
	});
});
