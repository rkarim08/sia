import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadModel } from "@/cli/commands/download-model";

describe("downloadModel", () => {
	let tempHome: string;

	beforeEach(() => {
		tempHome = mkdtempSync(join(tmpdir(), "sia-download-model-test-"));
	});

	afterEach(() => {
		rmSync(tempHome, { recursive: true, force: true });
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

	it("skips download when model and tokenizer files already exist", async () => {
		const modelsDir = join(tempHome, "models");
		mkdirSync(modelsDir, { recursive: true });

		// Pre-create both files with content
		writeFileSync(join(modelsDir, "all-MiniLM-L6-v2.onnx"), "existing-model-data");
		writeFileSync(join(modelsDir, "tokenizer.json"), "existing-tokenizer-data");

		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const result = await downloadModel(tempHome);

		// fetch should never be called since files exist
		expect(fetchSpy).not.toHaveBeenCalled();
		// Should log that model is already downloaded
		expect(logSpy).toHaveBeenCalledWith("Model already downloaded");
		// Should return the model path
		expect(result).toBe(join(modelsDir, "all-MiniLM-L6-v2.onnx"));
	});

	it("returns the correct model path", async () => {
		const modelsDir = join(tempHome, "models");
		mkdirSync(modelsDir, { recursive: true });

		// Pre-create both files
		writeFileSync(join(modelsDir, "all-MiniLM-L6-v2.onnx"), "data");
		writeFileSync(join(modelsDir, "tokenizer.json"), "data");

		vi.spyOn(console, "log").mockImplementation(() => {});

		const result = await downloadModel(tempHome);
		expect(typeof result).toBe("string");
		expect(result).toBe(join(tempHome, "models", "all-MiniLM-L6-v2.onnx"));
	});

	it("downloads model when only tokenizer exists", async () => {
		const modelsDir = join(tempHome, "models");
		mkdirSync(modelsDir, { recursive: true });

		// Only create tokenizer
		writeFileSync(join(modelsDir, "tokenizer.json"), "existing-tokenizer-data");

		const fakeBody = () =>
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("fake-data"));
					controller.close();
				},
			});

		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(fakeBody(), {
				status: 200,
				headers: { "content-length": "9" },
			}),
		);

		vi.spyOn(console, "log").mockImplementation(() => {});

		await downloadModel(tempHome);

		// Should have called fetch once for the model only
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		// The model file should now exist
		expect(existsSync(join(modelsDir, "all-MiniLM-L6-v2.onnx"))).toBe(true);
	});
});
