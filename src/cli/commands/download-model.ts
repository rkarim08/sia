// Module: download-model — download ONNX models from the registry by tier
import { createHash } from "node:crypto";
import {
	createReadStream,
	existsSync,
	mkdirSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createModelManager, type ModelManager } from "@/models/manager";
import { getModelsForTier } from "@/models/registry";
import type { ModelTier } from "@/models/types";
import { SIA_HOME } from "@/shared/config";

/**
 * Download a single file from `url` to `destPath`.
 * Writes to a temporary file first, then renames for atomicity.
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
	}

	const contentLength = Number(response.headers.get("content-length") ?? 0);
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error(`No response body for ${url}`);
	}

	const chunks: Uint8Array[] = [];
	let received = 0;
	let lastPercent = -1;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.length;

		if (contentLength > 0) {
			const percent = Math.floor((received / contentLength) * 100);
			if (percent !== lastPercent && percent % 10 === 0) {
				console.log(`Downloading ${destPath}... ${percent}%`);
				lastPercent = percent;
			}
		}
	}

	const buffer = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.length;
	}

	const tempPath = `${destPath}.tmp`;
	writeFileSync(tempPath, buffer);
	renameSync(tempPath, destPath);
	console.log(`Downloaded ${destPath} (${received} bytes)`);
}

/**
 * Verify the SHA-256 checksum of a file via streaming.
 * Returns true if match, false if mismatch. Deletes file on mismatch.
 */
export async function verifyModelChecksum(
	filePath: string,
	expectedHash: string,
): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => {
			const actual = hash.digest("hex");
			if (actual !== expectedHash) {
				unlinkSync(filePath);
				console.error(`Checksum mismatch for ${filePath}: expected ${expectedHash}, got ${actual}`);
				resolve(false);
			} else {
				resolve(true);
			}
		});
		stream.on("error", reject);
	});
}

/** Check whether a file exists and has size > 0. */
function fileExistsWithContent(filePath: string): boolean {
	if (!existsSync(filePath)) return false;
	const stats = statSync(filePath);
	return stats.size > 0;
}

/**
 * Download all models for a given tier using the MODEL_REGISTRY.
 *
 * For each model in the tier, downloads the ONNX model file and optional
 * tokenizer to `{siaHome}/models/{modelName}/`. Verifies SHA-256 checksums
 * unless SIA_SKIP_CHECKSUM is set. Records each model in the manifest.
 *
 * @returns The ModelManager after all downloads complete.
 */
export async function downloadModelsForTier(
	tier: ModelTier = "T0",
	siaHome: string = SIA_HOME,
): Promise<ModelManager> {
	const manager = createModelManager(siaHome);
	const models = getModelsForTier(tier);

	for (const [name, entry] of Object.entries(models)) {
		const modelDir = join(manager.getModelsDir(), name);
		if (!existsSync(modelDir)) {
			mkdirSync(modelDir, { recursive: true });
		}

		const modelFileName = entry.file.split("/").pop()!;
		const modelPath = join(modelDir, modelFileName);
		const hfBaseUrl = `https://huggingface.co/${entry.huggingface}/resolve/main`;

		// Download model file
		if (!fileExistsWithContent(modelPath)) {
			console.log(`Downloading ${name} model...`);
			await downloadFile(`${hfBaseUrl}/${entry.file}`, modelPath);
			if (!process.env.SIA_SKIP_CHECKSUM && !entry.sha256.startsWith("PLACEHOLDER")) {
				const ok = await verifyModelChecksum(modelPath, entry.sha256);
				if (!ok) {
					console.error(`Checksum verification failed for ${name} — skipping`);
					continue;
				}
			}
		}

		// Download tokenizer if specified
		if (entry.tokenizerFile) {
			const tokPath = join(modelDir, entry.tokenizerFile);
			if (!fileExistsWithContent(tokPath)) {
				console.log(`Downloading ${name} tokenizer...`);
				await downloadFile(`${hfBaseUrl}/${entry.tokenizerFile}`, tokPath);
				if (
					!process.env.SIA_SKIP_CHECKSUM &&
					entry.tokenizerSha256 &&
					!entry.tokenizerSha256.startsWith("PLACEHOLDER")
				) {
					const ok = await verifyModelChecksum(tokPath, entry.tokenizerSha256);
					if (!ok) {
						console.error(`Tokenizer checksum verification failed for ${name} — skipping`);
						continue;
					}
				}
			}
		}

		// Record in manifest
		if (!manager.isModelInstalled(name)) {
			manager.recordModelInstalled(name, {
				version: "1.0.0",
				variant: "int8",
				sha256: entry.sha256,
				sizeBytes: entry.sizeBytes,
				source: entry.huggingface,
				installedAt: new Date().toISOString(),
				tier: entry.tier,
			});
		}
	}

	manager.setInstalledTier(tier);
	return manager;
}

/**
 * Legacy entry point — downloads T0 models (bge-small + MiniLM).
 * Preserved for backward compatibility with existing callers.
 *
 * @returns Path to the primary model directory.
 */
export async function downloadModel(siaHome: string = SIA_HOME): Promise<string> {
	const manager = await downloadModelsForTier("T0", siaHome);
	return manager.getModelsDir();
}
