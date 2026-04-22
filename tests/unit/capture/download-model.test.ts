import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadModel } from "@/cli/commands/download-model";

describe("downloadModel", () => {
	let tempHome: string;

	beforeEach(() => {
		tempHome = mkdtempSync(join(tmpdir(), "sia-download-model-test-"));
		process.env.SIA_SKIP_CHECKSUM = "1";
	});

	afterEach(() => {
		rmSync(tempHome, { recursive: true, force: true });
		delete process.env.SIA_SKIP_CHECKSUM;
		vi.restoreAllMocks();
	});

	it("creates the models directory if it does not exist", async () => {
		const modelsDir = join(tempHome, "models");
		expect(existsSync(modelsDir)).toBe(false);

		// Mock fetch to return a fresh response for each call
		vi.spyOn(globalThis, "fetch").mockImplementation(() => {
			const body = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("fake-model-data"));
					controller.close();
				},
			});
			return Promise.resolve(
				new Response(body, {
					status: 200,
					headers: { "content-length": "15" },
				}),
			);
		});

		vi.spyOn(console, "log").mockImplementation(() => {});

		await downloadModel(tempHome);

		expect(existsSync(modelsDir)).toBe(true);
	});

	it("skips download when model files already exist", async () => {
		const modelsDir = join(tempHome, "models");

		// Pre-create T0 model subdirectories with files matching the registry layout
		const bgeDir = join(modelsDir, "bge-small-en-v1.5");
		const miniLMDir = join(modelsDir, "ms-marco-MiniLM-L-6-v2");
		mkdirSync(bgeDir, { recursive: true });
		mkdirSync(miniLMDir, { recursive: true });

		writeFileSync(join(bgeDir, "model_quantized.onnx"), "existing-model-data");
		writeFileSync(join(bgeDir, "tokenizer.json"), "existing-tokenizer-data");
		writeFileSync(join(miniLMDir, "model_quantized.onnx"), "existing-model-data");
		writeFileSync(join(miniLMDir, "tokenizer.json"), "existing-tokenizer-data");

		const fetchSpy = vi.spyOn(globalThis, "fetch");
		vi.spyOn(console, "log").mockImplementation(() => {});

		await downloadModel(tempHome);

		// fetch should never be called since files exist
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("returns the models directory path", async () => {
		const modelsDir = join(tempHome, "models");

		// Pre-create T0 model subdirectories with files
		const bgeDir = join(modelsDir, "bge-small-en-v1.5");
		const miniLMDir = join(modelsDir, "ms-marco-MiniLM-L-6-v2");
		mkdirSync(bgeDir, { recursive: true });
		mkdirSync(miniLMDir, { recursive: true });

		writeFileSync(join(bgeDir, "model_quantized.onnx"), "data");
		writeFileSync(join(bgeDir, "tokenizer.json"), "data");
		writeFileSync(join(miniLMDir, "model_quantized.onnx"), "data");
		writeFileSync(join(miniLMDir, "tokenizer.json"), "data");

		vi.spyOn(console, "log").mockImplementation(() => {});

		const result = await downloadModel(tempHome);
		expect(typeof result).toBe("string");
		expect(result).toBe(join(tempHome, "models"));
	});

	it("downloads model when files do not exist", async () => {
		const modelsDir = join(tempHome, "models");
		mkdirSync(modelsDir, { recursive: true });

		const fakeBody = () =>
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("fake-data"));
					controller.close();
				},
			});

		vi.spyOn(globalThis, "fetch").mockImplementation(() =>
			Promise.resolve(
				new Response(fakeBody(), {
					status: 200,
					headers: { "content-length": "9" },
				}),
			),
		);

		vi.spyOn(console, "log").mockImplementation(() => {});

		await downloadModel(tempHome);

		// T0 model files should now exist in per-model subdirectories
		expect(existsSync(join(modelsDir, "bge-small-en-v1.5", "model_quantized.onnx"))).toBe(true);
		expect(existsSync(join(modelsDir, "ms-marco-MiniLM-L-6-v2", "model_quantized.onnx"))).toBe(
			true,
		);
	});
});
