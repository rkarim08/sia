import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createModelManager, type ModelManager } from "@/models/manager";

describe("ModelManager", () => {
	let tmpDir: string;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-models-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("creates manifest on first init", () => {
		tmpDir = makeTmp();
		const manager = createModelManager(tmpDir);
		const manifest = manager.getManifest();
		expect(manifest.schemaVersion).toBe(1);
		expect(manifest.installedTier).toBe("T0");
		expect(manifest.models).toEqual({});
	});

	it("saves and loads manifest from disk", () => {
		tmpDir = makeTmp();
		const manager = createModelManager(tmpDir);
		manager.recordModelInstalled("test-model", {
			version: "1.0.0",
			variant: "int8",
			sha256: "abc123",
			sizeBytes: 1000,
			source: "test",
			installedAt: new Date().toISOString(),
			tier: "T0",
		});

		// Create new manager from same directory — should load saved manifest
		const manager2 = createModelManager(tmpDir);
		expect(manager2.getManifest().models["test-model"]).toBeDefined();
		expect(manager2.getManifest().models["test-model"].sha256).toBe("abc123");
	});

	it("getModelPath returns correct path", () => {
		tmpDir = makeTmp();
		const manager = createModelManager(tmpDir);
		const path = manager.getModelPath("bge-small-en-v1.5", "model-int8.onnx");
		expect(path).toBe(join(tmpDir, "models", "bge-small-en-v1.5", "model-int8.onnx"));
	});

	it("isModelInstalled returns false for missing model", () => {
		tmpDir = makeTmp();
		const manager = createModelManager(tmpDir);
		expect(manager.isModelInstalled("nonexistent")).toBe(false);
	});

	it("isModelInstalled returns true after recording", () => {
		tmpDir = makeTmp();
		const manager = createModelManager(tmpDir);
		manager.recordModelInstalled("test-model", {
			version: "1.0.0",
			variant: "int8",
			sha256: "abc",
			sizeBytes: 100,
			source: "test",
			installedAt: new Date().toISOString(),
			tier: "T0",
		});
		expect(manager.isModelInstalled("test-model")).toBe(true);
	});

	it("removeModel deletes entry from manifest", () => {
		tmpDir = makeTmp();
		const manager = createModelManager(tmpDir);
		manager.recordModelInstalled("test-model", {
			version: "1.0.0",
			variant: "int8",
			sha256: "abc",
			sizeBytes: 100,
			source: "test",
			installedAt: new Date().toISOString(),
			tier: "T0",
		});
		manager.removeModel("test-model");
		expect(manager.isModelInstalled("test-model")).toBe(false);
	});

	it("verifyChecksum returns true for matching SHA-256", async () => {
		tmpDir = makeTmp();
		const manager = createModelManager(tmpDir);
		const modelDir = join(tmpDir, "models", "test-model");
		mkdirSync(modelDir, { recursive: true });
		const content = Buffer.from("test content");
		writeFileSync(join(modelDir, "model.onnx"), content);

		// Compute expected SHA-256
		const crypto = await import("node:crypto");
		const expected = crypto.createHash("sha256").update(content).digest("hex");

		const result = await manager.verifyChecksum(join(modelDir, "model.onnx"), expected);
		expect(result).toBe(true);
	});

	it("verifyChecksum returns false for mismatched SHA-256", async () => {
		tmpDir = makeTmp();
		const manager = createModelManager(tmpDir);
		const modelDir = join(tmpDir, "models", "test-model");
		mkdirSync(modelDir, { recursive: true });
		writeFileSync(join(modelDir, "model.onnx"), "test content");

		const result = await manager.verifyChecksum(join(modelDir, "model.onnx"), "wrong_hash");
		expect(result).toBe(false);
	});

	it("recovers from corrupt manifest.json", () => {
		tmpDir = makeTmp();
		const modelsDir = join(tmpDir, "models");
		mkdirSync(modelsDir, { recursive: true });
		writeFileSync(join(modelsDir, "manifest.json"), "NOT VALID JSON{{{", "utf-8");

		// Should not throw — should recover to empty manifest
		const manager = createModelManager(tmpDir);
		const manifest = manager.getManifest();
		expect(manifest.schemaVersion).toBe(1);
		expect(manifest.installedTier).toBe("T0");
		expect(manifest.models).toEqual({});
	});

	it("verifyChecksum returns false for missing file", async () => {
		tmpDir = makeTmp();
		const manager = createModelManager(tmpDir);
		const result = await manager.verifyChecksum("/nonexistent/path.onnx", "abc123");
		expect(result).toBe(false);
	});

	it("removeModel with deleteFiles removes directory", () => {
		tmpDir = makeTmp();
		const manager = createModelManager(tmpDir);
		const modelDir = join(tmpDir, "models", "test-model");
		mkdirSync(modelDir, { recursive: true });
		writeFileSync(join(modelDir, "model.onnx"), "fake model");

		manager.recordModelInstalled("test-model", {
			version: "1.0.0",
			variant: "int8",
			sha256: "abc",
			sizeBytes: 100,
			source: "test",
			installedAt: new Date().toISOString(),
			tier: "T0",
		});
		manager.removeModel("test-model", true);

		expect(manager.isModelInstalled("test-model")).toBe(false);
		expect(existsSync(modelDir)).toBe(false);
	});
});
