// Module: download-model — downloads the all-MiniLM-L6-v2 ONNX model and tokenizer
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
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
	}

	// Download tokenizer if needed
	if (!fileExistsWithContent(tokenizerPath)) {
		console.log("Downloading tokenizer...");
		await downloadFile(TOKENIZER_URL, tokenizerPath);
	}

	return modelPath;
}
