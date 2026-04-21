import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, renameSync, unlinkSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Compute SHA-256 hex digest of a file.
 */
export async function computeFileSha256(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("hex")));
		stream.on("error", reject);
	});
}

/**
 * Download a file from a URL to a local path with atomic write.
 *
 * Writes to a temporary file first, then renames to the final path.
 * Reports progress via optional callback.
 */
export async function downloadFile(
	url: string,
	destPath: string,
	onProgress?: (downloaded: number, total: number | null) => void,
	opts?: { airGapped?: boolean },
): Promise<void> {
	if (opts?.airGapped) {
		throw new Error(
			`Cannot download model in air-gapped mode. ` +
			`Pre-install models manually at: ${destPath}\n` +
			`Download from: ${url}`,
		);
	}

	const dir = dirname(destPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const tmpPath = `${destPath}.download`;

	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok) {
		throw new Error(`Download failed: ${response.status} ${response.statusText} for ${url}`);
	}

	const contentLength = response.headers.get("content-length");
	const total = contentLength ? parseInt(contentLength, 10) : null;
	let downloaded = 0;

	const body = response.body;
	if (!body) {
		throw new Error(`No response body for ${url}`);
	}

	const writer = createWriteStream(tmpPath);
	const reader = body.getReader();

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			writer.write(Buffer.from(value));
			downloaded += value.byteLength;

			if (onProgress) {
				onProgress(downloaded, total);
			}
		}
	} finally {
		writer.end();
		// Wait for write to complete
		await new Promise<void>((resolve, reject) => {
			writer.on("finish", resolve);
			writer.on("error", reject);
		});
	}

	// Atomic rename — clean up temp file on failure
	try {
		if (existsSync(destPath)) {
			unlinkSync(destPath);
		}
		renameSync(tmpPath, destPath);
	} catch (err) {
		// Clean up partial temp file
		try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* best effort */ }
		throw err;
	}
}

/**
 * Download a model file and verify its SHA-256 checksum.
 * Deletes the file if checksum doesn't match.
 *
 * @returns true if download and verification succeeded
 */
export async function downloadAndVerify(
	url: string,
	destPath: string,
	expectedSha256: string,
	onProgress?: (downloaded: number, total: number | null) => void,
): Promise<boolean> {
	await downloadFile(url, destPath, onProgress);

	const actualSha256 = await computeFileSha256(destPath);
	if (actualSha256 !== expectedSha256) {
		unlinkSync(destPath);
		throw new Error(
			`Checksum mismatch for ${destPath}:\n` +
			`  expected: ${expectedSha256}\n` +
			`  actual:   ${actualSha256}\n` +
			`File deleted. Retry download.`,
		);
	}

	return true;
}

/**
 * Download all files for a model from the registry.
 *
 * @param huggingfaceRepo - e.g. "Xenova/bge-small-en-v1.5"
 * @param files - map of filename → { remotePath, sha256 }
 * @param destDir - local directory to save files
 */
export async function downloadModel(
	huggingfaceRepo: string,
	files: Array<{ remotePath: string; localName: string; sha256: string }>,
	destDir: string,
	onProgress?: (file: string, downloaded: number, total: number | null) => void,
): Promise<void> {
	for (const file of files) {
		const url = `https://huggingface.co/${huggingfaceRepo}/resolve/main/${file.remotePath}`;
		const destPath = `${destDir}/${file.localName}`;

		// Skip if already downloaded and verified
		if (existsSync(destPath)) {
			try {
				const hash = await computeFileSha256(destPath);
				if (hash === file.sha256) continue;
			} catch (err) {
				console.warn(
					`[sia] downloader: could not verify existing file ${destPath}, re-downloading:`,
					err instanceof Error ? err.message : String(err),
				);
			}
		}

		await downloadAndVerify(
			url,
			destPath,
			file.sha256,
			onProgress ? (dl, total) => onProgress(file.localName, dl, total) : undefined,
		);
	}
}
