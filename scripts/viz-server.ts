#!/usr/bin/env bun

// SIA Graph Visualizer — Live browser companion server
//
// Watches a directory for HTML files and serves the newest one.
// Based on superpowers' visual companion pattern.
//
// Usage: bun run scripts/viz-server.ts --screen-dir <dir> [--port <port>]

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";

// Frame template with SIA branding
export const FRAME_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SIA Knowledge Graph</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; }
  .header { padding: 12px 24px; background: #16213e; border-bottom: 1px solid #0f3460; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 16px; font-weight: 600; color: #e94560; }
  .header .subtitle { font-size: 13px; color: #888; }
  .content { padding: 24px; }
  h2 { color: #e94560; margin-bottom: 16px; }
  h3 { color: #ccc; margin-bottom: 8px; }
  .subtitle { color: #888; font-size: 14px; }
  .options { display: flex; flex-wrap: wrap; gap: 16px; margin: 16px 0; }
  .option { background: #16213e; border: 2px solid #0f3460; border-radius: 8px; padding: 16px; cursor: pointer; flex: 1; min-width: 200px; transition: all 0.2s; }
  .option:hover { border-color: #e94560; }
  .option.selected { border-color: #e94560; background: #1a1a3e; }
</style>
</head>
<body>
<div class="header">
  <h1>SIA</h1>
  <span class="subtitle">Knowledge Graph Visualizer</span>
</div>
<div class="content">
{{CONTENT}}
</div>
<script>
function toggleSelect(el) {
  document.querySelectorAll('.option, .card').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  const choice = el.dataset.choice;
  const text = el.textContent.trim().slice(0, 100);
  fetch('/event', { method: 'POST', body: JSON.stringify({ type: 'click', choice, text, timestamp: Date.now() }) });
}
</script>
</body>
</html>`;

/** Replace the {{CONTENT}} placeholder in the frame template. */
export function buildFrameHtml(content: string): string {
	return FRAME_TEMPLATE.replace("{{CONTENT}}", content);
}

/** Find the newest .html file in the given directory. Returns filename or null. */
export function getNewestHtml(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir)
		.filter((f) => extname(f) === ".html")
		.map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
		.sort((a, b) => b.mtime - a.mtime);
	return files.length > 0 ? files[0].name : null;
}

/** Start the viz server. Only runs when executed directly (not imported for tests). */
export function startServer(screenDir: string, port: number): void {
	mkdirSync(screenDir, { recursive: true });

	const server = createServer((req, res) => {
		if (req.method === "POST" && req.url === "/event") {
			const chunks: Buffer[] = [];
			req.on("data", (c) => chunks.push(c));
			req.on("end", () => {
				appendFileSync(join(screenDir, ".events"), `${Buffer.concat(chunks).toString()}\n`);
				res.writeHead(200);
				res.end("ok");
			});
			return;
		}

		if (req.url === "/health") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "ok" }));
			return;
		}

		const newest = getNewestHtml(screenDir);
		if (!newest) {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(buildFrameHtml("<p class='subtitle'>Waiting for visualization...</p>"));
			return;
		}

		const content = readFileSync(join(screenDir, newest), "utf-8");
		res.writeHead(200, { "Content-Type": "text/html" });

		if (content.startsWith("<!DOCTYPE") || content.startsWith("<html")) {
			res.end(content);
		} else {
			res.end(buildFrameHtml(content));
		}
	});

	server.listen(port, () => {
		const info = {
			type: "server-started",
			port,
			url: `http://localhost:${port}`,
			screen_dir: screenDir,
		};
		writeFileSync(join(screenDir, ".server-info"), JSON.stringify(info));
		console.log(JSON.stringify(info));
	});
}

// --- CLI entry point ---
// Only start server when run directly, not when imported for testing
const isDirectRun =
	process.argv[1]?.endsWith("viz-server.ts") || process.argv[1]?.endsWith("viz-server.js");

if (isDirectRun) {
	const args = process.argv.slice(2);
	let screenDir = "";
	let port = 52742;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--screen-dir" && args[i + 1]) screenDir = args[++i];
		if (args[i] === "--port" && args[i + 1]) port = parseInt(args[++i], 10);
	}

	if (!screenDir) {
		console.error("Usage: bun run viz-server.ts --screen-dir <dir>");
		process.exit(1);
	}

	startServer(screenDir, port);
}
