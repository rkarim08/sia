// Module: chunker — Convert HookPayload into CandidateFact[], applying
// filtering, trust-tier assignment, and paranoid-capture quarantining.

import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";
import type { SiaConfig } from "@/shared/config";
import type { CandidateFact, HookPayload } from "./types";

/** File extensions considered "recognised" source code for Tier 2 classification. */
const RECOGNISED_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
	".md",
	".yaml",
	".yml",
	".toml",
	".py",
	".rs",
	".go",
	".java",
	".c",
	".cpp",
	".h",
	".hpp",
	".cs",
	".rb",
	".php",
	".swift",
	".kt",
	".sh",
	".bash",
	".zsh",
	".sql",
	".html",
	".css",
	".scss",
	".less",
	".vue",
	".svelte",
]);

/** Regex that matches http:// or https:// URLs. */
const URL_RE = /https?:\/\/[^\s)>"']+/g;

/**
 * Return true when `url` points outside the project working directory.
 * Localhost / 127.0.0.1 URLs are treated as internal.
 */
function isExternalUrl(url: string, cwd: string): boolean {
	// file:// or paths starting with cwd are internal
	if (url.startsWith(`file://${cwd}`)) return false;
	try {
		const parsed = new URL(url);
		const host = parsed.hostname;
		if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
			return false;
		}
	} catch {
		// Malformed URL — treat as external to be safe
		return true;
	}
	return true;
}

/**
 * Determine whether a filePath has a recognised source-code extension.
 */
function hasRecognisedExtension(filePath: string): boolean {
	const dot = filePath.lastIndexOf(".");
	if (dot === -1) return false;
	return RECOGNISED_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

/**
 * Convert a single HookPayload into zero or one CandidateFact entries.
 *
 * Filtering rules (returns []):
 *  - empty content
 *  - content shorter than 20 characters
 *  - node_modules reads (toolName contains 'Read' AND filePath contains 'node_modules')
 *
 * Trust tier assignment:
 *  - Tier 1: type === 'Stop'
 *  - Tier 2: filePath with recognised source extension
 *  - Tier 3: no filePath
 *  - Tier 4: content contains external URLs (http/https not matching cwd)
 *
 * paranoidCapture + Tier 4: writes QUARANTINE audit entry and discards.
 */
export async function chunkPayload(
	payload: HookPayload,
	config: SiaConfig,
	db?: SiaDb,
): Promise<CandidateFact[]> {
	// --- Filtering -----------------------------------------------------------

	// Empty content
	if (!payload.content || payload.content.trim().length === 0) {
		return [];
	}

	// Content shorter than 20 chars
	if (payload.content.length < 20) {
		return [];
	}

	// node_modules reads
	if (payload.toolName?.includes("Read") && payload.filePath?.includes("node_modules")) {
		return [];
	}

	// --- Trust tier assignment -----------------------------------------------

	let trust_tier: 1 | 2 | 3 | 4;

	if (payload.type === "Stop") {
		trust_tier = 1;
	} else if (payload.filePath && hasRecognisedExtension(payload.filePath)) {
		trust_tier = 2;
	} else if (!payload.filePath) {
		trust_tier = 3;
	} else {
		// filePath present but unrecognised extension — default to Tier 2
		trust_tier = 2;
	}

	// Check for external URLs — promotes to Tier 4
	const urls = payload.content.match(URL_RE) ?? [];
	const hasExternal = urls.some((u) => isExternalUrl(u, payload.cwd));
	if (hasExternal) {
		trust_tier = 4;
	}

	// --- Paranoid capture quarantine -----------------------------------------

	if (config.paranoidCapture && trust_tier === 4) {
		if (db) {
			await writeAuditEntry(db, "QUARANTINE", {
				trust_tier: 4,
				source_episode: payload.sessionId,
			});
		}
		return [];
	}

	// --- Build CandidateFact -------------------------------------------------

	const name = payload.content.trim().slice(0, 50).trim();
	const summary = payload.content.trim().slice(0, 100).trim();

	const fact: CandidateFact = {
		type: "Concept",
		name,
		content: payload.content,
		summary,
		tags: [],
		file_paths: payload.filePath ? [payload.filePath] : [],
		trust_tier,
		confidence: trust_tier <= 2 ? 0.8 : 0.5,
		extraction_method: "chunker",
	};

	return [fact];
}
