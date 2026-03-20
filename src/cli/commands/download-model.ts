// Module: download-model — downloads the all-MiniLM-L6-v2 ONNX model and tokenizer
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { SIA_HOME } from "@/shared/config";

const MODEL_URL =
	"https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx";
const TOKENIZER_URL = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json";

const MODEL_FILENAME = "all-MiniLM-L6-v2.onnx";
const TOKENIZER_FILENAME = "tokenizer.json";

/**
 * Download a single file from `url` to `destPath`.
 * Writes to a temporary file first, then renames to the final destination.
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

	// Concatenate chunks into a single buffer
	const buffer = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.length;
	}

	// Write to temp file first, then rename for atomicity
	const tempPath = `${destPath}.tmp`;
	writeFileSync(tempPath, buffer);
	renameSync(tempPath, destPath);

	console.log(`Downloaded ${destPath} (${received} bytes)`);
}

/**
 * Verify the SHA-256 checksum of a file against an expected hash.
 *
 * If the hashes match, returns without error.
 * If the hashes do not match, deletes the file and throws an error.
 *
 * @param filePath     Path to the file to verify.
 * @param expectedHash Hex-encoded SHA-256 digest to compare against.
 */
export function verifyModelChecksum(filePath: string, expectedHash: string): void {
	const fileBuffer = readFileSync(filePath);
	const actualHash = createHash("sha256").update(fileBuffer).digest("hex");
	if (actualHash !== expectedHash) {
		unlinkSync(filePath);
		throw new Error(
			`Checksum mismatch for ${filePath}: expected ${expectedHash}, got ${actualHash}`,
		);
	}
}

/**
 * Check whether a file exists and has size > 0.
 */
function fileExistsWithContent(filePath: string): boolean {
	if (!existsSync(filePath)) return false;
	const stats = statSync(filePath);
	return stats.size > 0;
}

/**
 * Download the all-MiniLM-L6-v2 ONNX model and its tokenizer.
 *
 * Files are saved to `{siaHome}/models/`.
 * If both files already exist with size > 0, the download is skipped.
 *
 * @returns The path to the downloaded model file.
 */
export async function downloadModel(siaHome: string = SIA_HOME): Promise<string> {
	const modelsDir = join(siaHome, "models");
	const modelPath = join(modelsDir, MODEL_FILENAME);
	const tokenizerPath = join(modelsDir, TOKENIZER_FILENAME);

	// Ensure models directory exists
	if (!existsSync(modelsDir)) {
		mkdirSync(modelsDir, { recursive: true });
	}

	// Check if model already exists
	if (fileExistsWithContent(modelPath) && fileExistsWithContent(tokenizerPath)) {
		console.log("Model already downloaded");
		return modelPath;
	}

	// Download model if needed
	if (!fileExistsWithContent(modelPath)) {
		console.log("Downloading ONNX model...");
		await downloadFile(MODEL_URL, modelPath);
		// TODO: Replace placeholder with the real SHA-256 hash from the HuggingFace model card:
		// https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/main/onnx/model_quantized.onnx
		const MODEL_EXPECTED_HASH = "CHECKSUM_NOT_YET_KNOWN";
		if (MODEL_EXPECTED_HASH !== "CHECKSUM_NOT_YET_KNOWN") {
			verifyModelChecksum(modelPath, MODEL_EXPECTED_HASH);
		} else {
			console.warn(
				"[warn] Model checksum not configured — skipping integrity verification. " +
					"Set the real SHA-256 hash in download-model.ts to enable verification.",
			);
		}
	}

	// Download tokenizer if needed
	if (!fileExistsWithContent(tokenizerPath)) {
		console.log("Downloading tokenizer...");
		await downloadFile(TOKENIZER_URL, tokenizerPath);
		// TODO: Replace placeholder with the real SHA-256 hash from the HuggingFace model card:
		// https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/main/tokenizer.json
		const TOKENIZER_EXPECTED_HASH = "CHECKSUM_NOT_YET_KNOWN";
		if (TOKENIZER_EXPECTED_HASH !== "CHECKSUM_NOT_YET_KNOWN") {
			verifyModelChecksum(tokenizerPath, TOKENIZER_EXPECTED_HASH);
		} else {
			console.warn(
				"[warn] Tokenizer checksum not configured — skipping integrity verification. " +
					"Set the real SHA-256 hash in download-model.ts to enable verification.",
			);
		}
	}

	return modelPath;
}
