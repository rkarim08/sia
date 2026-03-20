// Module: sia-fetch-and-index — Fetch a URL, convert to markdown, and index via contentTypeChunker

import { randomUUID } from "node:crypto";
import * as dns from "node:dns/promises";
import { z } from "zod";
import TurndownService from "turndown";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import { applyContextMode, contentTypeChunker } from "@/sandbox/context-mode";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export const SiaFetchAndIndexInput = z.object({
	url: z.string(),
	intent: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

export interface SiaFetchAndIndexResult {
	indexed?: number;
	contentType?: string;
	sourceUrl?: string;
	externalRefId?: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// SSRF Protection
// ---------------------------------------------------------------------------

/**
 * Returns true if the given IP address is a private/loopback/link-local address.
 * Checks IPv4 ranges: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 * 169.254.0.0/16, and IPv6 loopback ::1.
 */
export function isPrivateIp(ip: string): boolean {
	// IPv6 loopback
	if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") {
		return true;
	}

	// Parse IPv4 octets
	const parts = ip.split(".");
	if (parts.length !== 4) {
		// Non-IPv4 that isn't ::1 — treat as potentially private to be safe
		return true;
	}

	const [a, b, c] = parts.map(Number);

	// 127.0.0.0/8 — loopback
	if (a === 127) return true;
	// 10.0.0.0/8 — private
	if (a === 10) return true;
	// 172.16.0.0/12 — private (172.16.x.x through 172.31.x.x)
	if (a === 172 && b >= 16 && b <= 31) return true;
	// 192.168.0.0/16 — private
	if (a === 192 && b === 168) return true;
	// 169.254.0.0/16 — link-local
	if (a === 169 && b === 254) return true;
	// 0.0.0.0/8 — this network
	if (a === 0) return true;

	return false;
}

// ---------------------------------------------------------------------------
// handleSiaFetchAndIndex
// ---------------------------------------------------------------------------

export async function handleSiaFetchAndIndex(
	db: SiaDb,
	input: z.infer<typeof SiaFetchAndIndexInput>,
	embedder: Embedder,
	sessionId: string,
): Promise<SiaFetchAndIndexResult> {
	const { url, intent, tags } = input;

	// 1. Parse URL — error if invalid
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { error: `Invalid URL: ${url}` };
	}

	// 2. Block non-HTTP(S) schemes
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return {
			error: `Only HTTP and HTTPS URLs are supported. Got: ${parsed.protocol}`,
		};
	}

	// 3. Resolve hostname via DNS → block private IPs
	const hostname = parsed.hostname;
	let resolvedIps: string[] = [];
	try {
		resolvedIps = await dns.resolve(hostname);
	} catch {
		// If DNS resolution fails entirely, attempt lookup as fallback
		try {
			const lookupResult = await dns.lookup(hostname);
			resolvedIps = [lookupResult.address];
		} catch {
			return { error: `DNS resolution failed for host: ${hostname}` };
		}
	}

	for (const ip of resolvedIps) {
		if (isPrivateIp(ip)) {
			return {
				error: `Blocked: ${hostname} resolves to private IP ${ip}`,
			};
		}
	}

	// 4. Fetch with timeout (30s), User-Agent header
	const MAX_CONTENT_LENGTH = 5 * 1024 * 1024; // 5 MB cap
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);

	let response: Response;
	try {
		response = await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent": "Sia-MCP/1.0 (knowledge graph indexer)",
				Accept: "text/html,text/markdown,application/json,text/plain,*/*",
			},
		});
	} catch (err) {
		clearTimeout(timeout);
		return { error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
	} finally {
		clearTimeout(timeout);
	}

	if (!response.ok) {
		return { error: `HTTP ${response.status}: ${response.statusText}` };
	}

	// 5. Content-type detection & size cap
	const rawContentType = response.headers.get("content-type") ?? "text/plain";
	const contentType = rawContentType.split(";")[0].trim().toLowerCase();

	// Check content-length header first
	const contentLengthHeader = response.headers.get("content-length");
	if (contentLengthHeader && Number(contentLengthHeader) > MAX_CONTENT_LENGTH) {
		return { error: `Response too large: ${contentLengthHeader} bytes (max ${MAX_CONTENT_LENGTH})` };
	}

	let rawBody: string;
	try {
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > MAX_CONTENT_LENGTH) {
			return { error: `Response too large: ${buffer.byteLength} bytes (max ${MAX_CONTENT_LENGTH})` };
		}
		rawBody = new TextDecoder().decode(buffer);
	} catch (err) {
		return { error: `Failed to read response body: ${err instanceof Error ? err.message : String(err)}` };
	}

	// 6. HTML → markdown via turndown
	let processedContent: string;
	if (contentType === "text/html") {
		const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
		processedContent = td.turndown(rawBody);
	} else {
		processedContent = rawBody;
	}

	// 7. Apply contentTypeChunker via applyContextMode pipeline
	const tagsJson = JSON.stringify(tags ?? []);
	const now = Date.now();
	const nowStr = String(now);

	const contextResult = await applyContextMode(
		processedContent,
		intent,
		contentTypeChunker,
		db,
		embedder,
		sessionId,
		{ threshold: 0, topK: 9999 }, // index all chunks
	);

	// Count total indexed — the applyContextMode stores ContentChunk nodes,
	// but with threshold 0 it always applies. We need to store chunks ourselves
	// with trust_tier 4 since applyContextMode uses trust_tier 3.
	// Re-chunk the content and insert with trust_tier 4:
	const rawChunks = contentTypeChunker.chunk(processedContent);
	const chunkIds: string[] = [];

	for (let i = 0; i < rawChunks.length; i++) {
		const raw = rawChunks[i];
		const nodeId = randomUUID();
		const chunkName = `fetch-chunk-${sessionId}-${i}`;
		const summary = raw.text.slice(0, 100);

		await db.execute(
			`INSERT INTO graph_nodes (id, type, name, summary, content, trust_tier, confidence, base_confidence, importance, base_importance, access_count, edge_count, tags, file_paths, t_created, t_valid_from, created_by, created_at, last_accessed)
			 VALUES (?, 'ContentChunk', ?, ?, ?, 4, 0.7, 0.7, 0.4, 0.4, 0, 0, ?, '[]', ?, ?, 'sia-fetch-and-index', ?, ?)`,
			[nodeId, chunkName, summary, raw.text, tagsJson, nowStr, nowStr, nowStr, nowStr],
		);

		chunkIds.push(nodeId);
	}

	// 8. Create ExternalRef node in graph_nodes
	const externalRefId = randomUUID();
	await db.execute(
		`INSERT INTO graph_nodes (id, type, name, summary, content, trust_tier, confidence, base_confidence, importance, base_importance, access_count, edge_count, tags, file_paths, t_created, t_valid_from, created_by, created_at, last_accessed)
		 VALUES (?, 'ExternalRef', ?, ?, ?, 4, 0.7, 0.7, 0.4, 0.4, 0, 0, ?, '[]', ?, ?, 'sia-fetch-and-index', ?, ?)`,
		[
			externalRefId,
			url,
			`External reference: ${url}`,
			url,
			tagsJson,
			nowStr,
			nowStr,
			nowStr,
			nowStr,
		],
	);

	// 9. Return result
	return {
		indexed: chunkIds.length,
		contentType,
		sourceUrl: url,
		externalRefId,
	};
}
