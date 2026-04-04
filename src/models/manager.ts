// Module: models/manager — model lifecycle: download, verify SHA-256, load, evict, upgrade/downgrade
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
	/** Update the attention head metadata in the manifest. */
	updateAttentionHeadMeta(meta: Partial<import("@/models/types").AttentionHeadMeta>): void;
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
		try {
			const raw = readFileSync(manifestPath, "utf-8");
			manifest = JSON.parse(raw) as ModelManifest;
		} catch (err) {
			console.error(
				`[sia] Failed to read manifest at ${manifestPath} — backing up corrupt file and resetting:`,
				err instanceof Error ? err.message : String(err),
			);
			try {
				const backupPath = `${manifestPath}.corrupt.${Date.now()}`;
				renameSync(manifestPath, backupPath);
				console.error(`[sia] Corrupt manifest backed up to ${backupPath}`);
			} catch {
				// Best-effort backup — proceed with reset even if rename fails
			}
			manifest = createEmptyManifest();
		}
	} else {
		manifest = createEmptyManifest();
	}
	// Always persist on init to ensure file exists and is valid
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

	function persistManifest(): void {
		try {
			writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
		} catch (err) {
			throw new Error(
				`[sia] Failed to persist model manifest to ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	return {
		getManifest(): ModelManifest {
			return structuredClone(manifest);
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
			const { createReadStream } = await import("node:fs");
			return new Promise<boolean>((resolve, reject) => {
				const hash = createHash("sha256");
				const stream = createReadStream(filePath);
				stream.on("data", (chunk) => hash.update(chunk));
				stream.on("end", () => resolve(hash.digest("hex") === expectedSha256));
				stream.on("error", (err) => reject(err));
			});
		},

		getModelsDir(): string {
			return modelsDir;
		},

		updateAttentionHeadMeta(meta: Partial<import("@/models/types").AttentionHeadMeta>): void {
			Object.assign(manifest.attentionHead, meta);
			persistManifest();
		},
	};
}
