import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Embedder } from "@/capture/embedder";
import { createEmbedder, createMultiModelEmbedder } from "@/capture/embedder";

describe("embedder", () => {
	let tmpDir: string;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-emb-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// createEmbedder returns an Embedder object
	// ---------------------------------------------------------------

	it("returns an Embedder object with embed and close methods", () => {
		const embedder = createEmbedder("/nonexistent/model.onnx", "/nonexistent/tokenizer.json");

		expect(embedder).toBeDefined();
		expect(typeof embedder.embed).toBe("function");
		expect(typeof embedder.close).toBe("function");
	});

	// ---------------------------------------------------------------
	// Embedder satisfies the Embedder interface
	// ---------------------------------------------------------------

	it("satisfies the Embedder interface", () => {
		const embedder: Embedder = createEmbedder(
			"/nonexistent/model.onnx",
			"/nonexistent/tokenizer.json",
		);

		// Type system ensures this is an Embedder; runtime check methods exist
		expect(embedder.embed).toBeDefined();
		expect(embedder.close).toBeDefined();
	});

	// ---------------------------------------------------------------
	// embed returns null when model file does not exist
	// ---------------------------------------------------------------

	it("embed returns null when model file does not exist", async () => {
		const embedder = createEmbedder("/nonexistent/model.onnx", "/nonexistent/tokenizer.json");

		const result = await embedder.embed("hello world");
		expect(result).toBeNull();
	});

	// ---------------------------------------------------------------
	// embed returns null when tokenizer file does not exist
	// ---------------------------------------------------------------

	it("embed returns null when tokenizer file does not exist", async () => {
		tmpDir = makeTmp();
		// Create a dummy model file but no tokenizer
		const modelPath = join(tmpDir, "model.onnx");
		writeFileSync(modelPath, "dummy");

		const embedder = createEmbedder(modelPath, "/nonexistent/tokenizer.json");

		const result = await embedder.embed("hello world");
		expect(result).toBeNull();
	});

	// ---------------------------------------------------------------
	// embed returns null when model file is invalid
	// ---------------------------------------------------------------

	it("embed returns null when model file is invalid (not a real ONNX model)", async () => {
		tmpDir = makeTmp();
		const modelPath = join(tmpDir, "model.onnx");
		const tokenizerPath = join(tmpDir, "tokenizer.json");

		writeFileSync(modelPath, "not a real onnx model");
		writeFileSync(
			tokenizerPath,
			JSON.stringify({
				model: {
					type: "WordPiece",
					vocab: { "[PAD]": 0, "[UNK]": 100, "[CLS]": 101, "[SEP]": 102, hello: 7592 },
				},
			}),
		);

		const embedder = createEmbedder(modelPath, tokenizerPath);

		const result = await embedder.embed("hello");
		expect(result).toBeNull();
	});

	// ---------------------------------------------------------------
	// close can be called safely even before embed
	// ---------------------------------------------------------------

	it("close can be called safely before embed", () => {
		const embedder = createEmbedder("/nonexistent/model.onnx", "/nonexistent/tokenizer.json");

		// Should not throw
		expect(() => embedder.close()).not.toThrow();
	});

	// ---------------------------------------------------------------
	// close can be called multiple times
	// ---------------------------------------------------------------

	it("close can be called multiple times without error", () => {
		const embedder = createEmbedder("/nonexistent/model.onnx", "/nonexistent/tokenizer.json");

		expect(() => {
			embedder.close();
			embedder.close();
			embedder.close();
		}).not.toThrow();
	});

	// ---------------------------------------------------------------
	// after close, embed re-initializes (returns null for missing model)
	// ---------------------------------------------------------------

	it("after close, embed returns null for missing model", async () => {
		const embedder = createEmbedder("/nonexistent/model.onnx", "/nonexistent/tokenizer.json");

		const result1 = await embedder.embed("test");
		expect(result1).toBeNull();

		embedder.close();

		const result2 = await embedder.embed("test");
		expect(result2).toBeNull();
	});

	// ---------------------------------------------------------------
	// embedBatch — batch embedding
	// ---------------------------------------------------------------

	it("embedBatch returns an array of results matching input length", async () => {
		const embedder = createEmbedder("/nonexistent/model.onnx", "/nonexistent/tokenizer.json");

		const results = await embedder.embedBatch(["hello", "world", "test"]);
		expect(results).toHaveLength(3);
		// All null since model doesn't exist
		expect(results[0]).toBeNull();
		expect(results[1]).toBeNull();
		expect(results[2]).toBeNull();
	});

	it("embedBatch handles empty input", async () => {
		const embedder = createEmbedder("/nonexistent/model.onnx", "/nonexistent/tokenizer.json");

		const results = await embedder.embedBatch([]);
		expect(results).toHaveLength(0);
	});

	it("embedBatch handles large batches (more than 16 items)", async () => {
		const embedder = createEmbedder("/nonexistent/model.onnx", "/nonexistent/tokenizer.json");

		const texts = Array.from({ length: 20 }, (_, i) => `text ${i}`);
		const results = await embedder.embedBatch(texts);
		expect(results).toHaveLength(20);
		// All null since model doesn't exist
		for (const r of results) {
			expect(r).toBeNull();
		}
	});

	it("embedBatch method exists on Embedder interface", () => {
		const embedder = createEmbedder("/nonexistent/model.onnx", "/nonexistent/tokenizer.json");
		expect(typeof embedder.embedBatch).toBe("function");
	});

	it("createMultiModelEmbedder returns an Embedder with model name", () => {
		const embedder = createMultiModelEmbedder({
			modelName: "bge-small-en-v1.5",
			modelPath: "/nonexistent/model.onnx",
			tokenizerPath: "/nonexistent/tokenizer.json",
			embeddingDim: 384,
			maxSeqLength: 512,
		});

		expect(embedder).toBeDefined();
		expect(typeof embedder.embed).toBe("function");
		expect(typeof embedder.close).toBe("function");
		expect(embedder.modelName).toBe("bge-small-en-v1.5");
		expect(embedder.embeddingDim).toBe(384);
	});

	it("multi-model embedder returns null when model file missing", async () => {
		const embedder = createMultiModelEmbedder({
			modelName: "bge-small-en-v1.5",
			modelPath: "/nonexistent/model.onnx",
			tokenizerPath: "/nonexistent/tokenizer.json",
			embeddingDim: 384,
			maxSeqLength: 512,
		});

		const result = await embedder.embed("hello world");
		expect(result).toBeNull();
	});
});
