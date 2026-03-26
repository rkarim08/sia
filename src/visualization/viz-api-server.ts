// src/visualization/viz-api-server.ts
// HTTP server exposing the visualizer frontend and graph data API.
// Uses Node's http module so it runs in both Bun and Node/vitest environments.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SiaDb } from "@/graph/db-interface";
import { expandFolder, extractInitialGraph, getFileEntities, searchNodes } from "@/visualization/file-graph-extract";
import { renderG6Html } from "@/visualization/g6-renderer";
import { extToLanguage } from "@/visualization/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = resolve(__dirname, "frontend-dist");

/** MIME types for static files. */
const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

/** Serve a static file from the frontend-dist directory. Returns true if served. */
function serveStatic(res: ServerResponse, urlPath: string): boolean {
	if (!existsSync(FRONTEND_DIST)) return false;

	// Normalize path, prevent traversal
	const safePath = urlPath.replace(/^\/+/, "").replace(/\.\./g, "");
	let filePath = join(FRONTEND_DIST, safePath);

	// If path is directory or root, serve index.html
	if (safePath === "" || safePath === "/" || (existsSync(filePath) && statSync(filePath).isDirectory())) {
		filePath = join(FRONTEND_DIST, "index.html");
	}

	if (!existsSync(filePath)) return false;

	try {
		const content = readFileSync(filePath);
		const ext = extname(filePath);
		const mime = MIME_TYPES[ext] || "application/octet-stream";
		res.writeHead(200, {
			"Content-Type": mime,
			"Access-Control-Allow-Origin": "*",
			"Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
		});
		res.end(content);
		return true;
	} catch {
		return false;
	}
}

/** Shape returned by createVizApiServer. */
export interface VizServer {
	/** The actual bound port (resolved after listen). */
	port: number;
	stop(force?: boolean): void;
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
	const body = JSON.stringify(data);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
	});
	res.end(body);
}

function sendHtml(res: ServerResponse, html: string, status = 200): void {
	res.writeHead(status, {
		"Content-Type": "text/html; charset=utf-8",
		"Access-Control-Allow-Origin": "*",
	});
	res.end(html);
}

function sendError(res: ServerResponse, message: string, status: number): void {
	sendJson(res, { error: message }, status);
}

function parseUrl(req: IncomingMessage): URL {
	return new URL(req.url ?? "/", `http://localhost`);
}

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
	db: SiaDb,
	projectRoot: string,
): Promise<void> {
	const url = parseUrl(req);
	const { pathname } = url;

	// GET / — serve built frontend (with fallback to legacy HTML)
	if (req.method === "GET" && pathname === "/") {
		if (serveStatic(res, "index.html")) return;
		// Fallback: serve legacy inline HTML if frontend not built
		sendHtml(res, renderG6Html());
		return;
	}

	// Static assets from frontend-dist (e.g. /assets/index-xxx.js)
	if (req.method === "GET" && !pathname.startsWith("/api/") && pathname !== "/health") {
		if (serveStatic(res, pathname)) return;
		// SPA fallback: serve index.html for unknown paths
		if (serveStatic(res, "index.html")) return;
	}

	// GET /health
	if (req.method === "GET" && pathname === "/health") {
		sendJson(res, { status: "ok" });
		return;
	}

	// GET /api/graph?scope=X
	if (req.method === "GET" && pathname === "/api/graph") {
		const scope = url.searchParams.get("scope") ?? undefined;
		try {
			const graph = await extractInitialGraph(db, { scope });
			sendJson(res, graph);
		} catch (err) {
			sendError(res, String(err), 500);
		}
		return;
	}

	// GET /api/expand/:comboId
	if (req.method === "GET" && pathname.startsWith("/api/expand/")) {
		const comboId = decodeURIComponent(pathname.slice("/api/expand/".length));
		try {
			const result = await expandFolder(db, comboId);
			sendJson(res, result);
		} catch (err) {
			sendError(res, String(err), 500);
		}
		return;
	}

	// GET /api/entities/:fileNodeId
	// fileNodeId format: "file:<path>" (URL-encoded)
	if (req.method === "GET" && pathname.startsWith("/api/entities/")) {
		const fileNodeId = decodeURIComponent(pathname.slice("/api/entities/".length));
		const filePath = fileNodeId.startsWith("file:")
			? fileNodeId.slice("file:".length)
			: fileNodeId;
		try {
			const result = await getFileEntities(db, filePath);
			sendJson(res, result);
		} catch (err) {
			sendError(res, String(err), 500);
		}
		return;
	}

	// GET /api/file?path=X
	if (req.method === "GET" && pathname === "/api/file") {
		const filePath = url.searchParams.get("path");
		if (!filePath) {
			sendError(res, "Missing path parameter", 400);
			return;
		}
		// Security: reject path traversal attempts
		if (filePath.includes("..") || filePath.startsWith("/")) {
			sendError(res, "Invalid path: path traversal not allowed", 400);
			return;
		}
		try {
			const absPath = join(projectRoot, filePath);
			// Verify the resolved path is still inside projectRoot
			const resolved = resolve(absPath);
			const resolvedRoot = resolve(projectRoot);
			if (!resolved.startsWith(resolvedRoot + "/") && resolved !== resolvedRoot) {
				sendError(res, "Invalid path: path traversal not allowed", 400);
				return;
			}
			const content = readFileSync(absPath, "utf-8");
			const ext = extname(filePath);
			const language = extToLanguage(ext);
			// Trim trailing newline before counting so "a\nb\nc\n" → 3 lines, not 4
			const lineCount = content.replace(/\n$/, "").split("\n").length;
			sendJson(res, { content, language, lineCount });
		} catch {
			sendError(res, `File not found: ${filePath}`, 404);
		}
		return;
	}

	// GET /api/search?q=X&limit=N
	if (req.method === "GET" && pathname === "/api/search") {
		const q = url.searchParams.get("q") ?? "";
		const limitParam = url.searchParams.get("limit");
		const limit = limitParam ? parseInt(limitParam, 10) : 20;
		try {
			const results = await searchNodes(db, q, limit);
			sendJson(res, { results });
		} catch (err) {
			sendError(res, String(err), 500);
		}
		return;
	}

	sendError(res, "Not found", 404);
}

/**
 * Create and start the visualizer API server.
 * Returns a Promise that resolves once the server is listening and the port is known.
 *
 * @param db          - Open SiaDb instance to query.
 * @param projectRoot - Absolute path to the project root (for /api/file reads).
 * @param port        - Port to listen on. Pass 0 for a random available port.
 */
export function createVizApiServer(
	db: SiaDb,
	projectRoot: string,
	port: number,
): Promise<VizServer> {
	return new Promise((resolveServer, reject) => {
		const server = createServer((req, res) => {
			handleRequest(req, res, db, projectRoot).catch((err) => {
				if (!res.headersSent) sendError(res, String(err), 500);
			});
		});

		server.once("error", reject);
		server.listen(port, "localhost", () => {
			const addr = server.address();
			const boundPort = addr && typeof addr === "object" ? addr.port : port;
			resolveServer({
				port: boundPort,
				stop(_force = false): void {
					server.closeAllConnections?.();
					server.close();
				},
			});
		});
	});
}
