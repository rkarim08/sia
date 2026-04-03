// Module: models/manager — model lifecycle: download, verify SHA-256, load, evict, upgrade/downgrade
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createEmptyManifest,
	type ModelEntry,
	type ModelManifest,
	type ModelTier,
} from "@/models/types";

/** Model manager interface for download, verify, load, and tier management. */
export interface ModelManager {
	/** Get the current manifest. */
	getManifest(): ModelManifest;
	/** Get the path to a model file within the models directory. */
	getModelPath(modelName: string, fileName: string): string;
	/** Check if a model is recorded in the manifest. */
	isModelInstalled(modelName: string): boolean;
	/** Record a model as installed in the manifest and persist to disk. */
	recordModelInstalled(modelName: string, entry: ModelEntry): void;
	/** Remove a model entry from the manifest and optionally delete files. */
	removeModel(modelName: string, deleteFiles?: boolean): void;
	/** Update the installed tier in the manifest. */
	setInstalledTier(tier: ModelTier): void;
	/** Verify a file's SHA-256 checksum. */
	verifyChecksum(filePath: string, expectedSha256: string): Promise<boolean>;
	/** Get the root models directory path. */
	getModelsDir(): string;
}

/**
 * Create a ModelManager that persists state to `{baseDir}/models/manifest.json`.
 */
export function createModelManager(baseDir: string): ModelManager {
	const modelsDir = join(baseDir, "models");
	const manifestPath = join(modelsDir, "manifest.json");

	// Ensure models directory exists
	if (!existsSync(modelsDir)) {
		mkdirSync(modelsDir, { recursive: true });
	}

	// Load or create manifest
	let manifest: ModelManifest;
	if (existsSync(manifestPath)) {
		const raw = readFileSync(manifestPath, "utf-8");
		manifest = JSON.parse(raw) as ModelManifest;
	} else {
		manifest = createEmptyManifest();
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
	}

	function persistManifest(): void {
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
	}

	return {
		getManifest(): ModelManifest {
			return manifest;
		},

		getModelPath(modelName: string, fileName: string): string {
			return join(modelsDir, modelName, fileName);
		},

		isModelInstalled(modelName: string): boolean {
			return modelName in manifest.models;
		},

		recordModelInstalled(modelName: string, entry: ModelEntry): void {
			manifest.models[modelName] = entry;
			persistManifest();
		},

		removeModel(modelName: string, deleteFiles = false): void {
			delete manifest.models[modelName];
			if (deleteFiles) {
				const modelDir = join(modelsDir, modelName);
				if (existsSync(modelDir)) {
					rmSync(modelDir, { recursive: true, force: true });
				}
			}
			persistManifest();
		},

		setInstalledTier(tier: ModelTier): void {
			manifest.installedTier = tier;
			persistManifest();
		},

		async verifyChecksum(filePath: string, expectedSha256: string): Promise<boolean> {
			if (!existsSync(filePath)) return false;
			const content = readFileSync(filePath);
			const actual = createHash("sha256").update(content).digest("hex");
			return actual === expectedSha256;
		},

		getModelsDir(): string {
			return modelsDir;
		},
	};
}
