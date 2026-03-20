// Module: executor — Subprocess spawning with timeout, output cap, language detection

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

export interface RuntimeDef {
	cmd: string;
	ext: string;
	/** If set, this is a compile-then-run language. Compiles first, then executes cmd. */
	compileCmd?: string;
}

export const RUNTIME_MAP: Record<string, RuntimeDef> = {
	python: { cmd: "python3", ext: ".py" },
	javascript: { cmd: "node", ext: ".js" },
	typescript: { cmd: "bun", ext: ".ts" },
	bash: { cmd: "bash", ext: ".sh" },
	ruby: { cmd: "ruby", ext: ".rb" },
	go: { cmd: "go", ext: ".go" },
	rust: { cmd: "rustc", ext: ".rs" },
	java: { cmd: "java", ext: ".java" },
	php: { cmd: "php", ext: ".php" },
	perl: { cmd: "perl", ext: ".pl" },
	r: { cmd: "Rscript", ext: ".r" },
	c: { cmd: "./script", ext: ".c", compileCmd: "gcc -o script {src}" },
	cpp: { cmd: "./script", ext: ".cpp", compileCmd: "g++ -o script {src}" },
	csharp: { cmd: "dotnet-script", ext: ".csx" },
};

const EXT_TO_LANG: Record<string, string> = {
	".py": "python",
	".js": "javascript",
	".ts": "typescript",
	".sh": "bash",
	".rb": "ruby",
	".go": "go",
	".rs": "rust",
	".java": "java",
	".php": "php",
	".pl": "perl",
	".r": "r",
	".c": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".csx": "csharp",
	".cs": "csharp",
};

const SHEBANG_PATTERNS: Array<[RegExp, string]> = [
	[/python/, "python"],
	[/node/, "javascript"],
	[/bun/, "typescript"],
	[/bash|sh/, "bash"],
	[/ruby/, "ruby"],
	[/perl/, "perl"],
];

export interface SubprocessOpts {
	language?: string;
	code: string;
	filePath?: string;
	timeout: number;
	cwd?: string;
	env?: Record<string, string>;
	outputMaxBytes?: number;
}

export interface SubprocessResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
	truncated: boolean;
	runtimeMs: number;
}

const DEFAULT_OUTPUT_MAX = 1_048_576; // 1MB

/**
 * Detect language from explicit param, file extension, or shebang line.
 * Throws if no language can be determined.
 */
export function detectLanguage(explicit?: string, filePath?: string, code?: string): string {
	if (explicit) return explicit;

	if (filePath) {
		const ext = extname(filePath).toLowerCase();
		if (EXT_TO_LANG[ext]) return EXT_TO_LANG[ext];
	}

	if (code) {
		const firstLine = code.split("\n")[0];
		if (firstLine.startsWith("#!")) {
			for (const [pattern, lang] of SHEBANG_PATTERNS) {
				if (pattern.test(firstLine)) return lang;
			}
		}
	}

	throw new Error("Cannot detect language. Provide an explicit `language` parameter.");
}

/**
 * Execute code in an isolated subprocess.
 */
export async function executeSubprocess(opts: SubprocessOpts): Promise<SubprocessResult> {
	const language = detectLanguage(opts.language, opts.filePath, opts.code);
	const runtime = RUNTIME_MAP[language];
	if (!runtime) throw new Error(`Unsupported language: ${language}`);

	const maxBytes = opts.outputMaxBytes ?? DEFAULT_OUTPUT_MAX;
	const tmpDir = mkdtempSync(join(tmpdir(), "sia-sandbox-"));
	const scriptPath = opts.filePath ?? join(tmpDir, `script${runtime.ext}`);

	if (!opts.filePath) {
		writeFileSync(scriptPath, opts.code);
	}

	const startMs = Date.now();

	// Compile step for compiled languages (C, C++)
	if (runtime.compileCmd) {
		const compileCmd = runtime.compileCmd.replace("{src}", scriptPath);
		const [cc, ...ccArgs] = compileCmd.split(" ");
		const compileResult = spawnSync(cc, ccArgs, {
			cwd: opts.cwd ?? tmpDir,
			timeout: Math.min(opts.timeout, 30_000),
			env: opts.env ?? process.env,
		});
		if (compileResult.status !== 0) {
			const runtimeMs = Date.now() - startMs;
			try {
				rmSync(tmpDir, { recursive: true, force: true });
			} catch (e) {
				console.error("[sia-sandbox] cleanup failed:", (e as Error).message);
			}
			return {
				stdout: "",
				stderr: compileResult.stderr?.toString() ?? "Compilation failed",
				exitCode: compileResult.status,
				timedOut: compileResult.signal === "SIGTERM",
				truncated: false,
				runtimeMs,
			};
		}
	}

	// Determine command and args
	const execCmd = runtime.cmd;
	const execArgs = runtime.compileCmd ? [] : [scriptPath];

	return new Promise<SubprocessResult>((resolve) => {
		const cmdParts = execCmd.split(" ");
		const proc = spawn(cmdParts[0], [...cmdParts.slice(1), ...execArgs], {
			cwd: opts.cwd ?? tmpDir,
			env: opts.env ?? process.env,
			detached: true,
		});

		let stdout = "";
		let stderr = "";
		let stdoutTruncated = false;
		let stderrTruncated = false;

		proc.stdout.on("data", (d: Buffer) => {
			if (stdout.length < maxBytes) {
				stdout += d.toString();
				if (stdout.length >= maxBytes) {
					stdout = stdout.slice(0, maxBytes);
					stdoutTruncated = true;
				}
			}
		});

		proc.stderr.on("data", (d: Buffer) => {
			if (stderr.length < maxBytes) {
				stderr += d.toString();
				if (stderr.length >= maxBytes) {
					stderr = stderr.slice(0, maxBytes);
					stderrTruncated = true;
				}
			}
		});

		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			// Kill entire process group to ensure child processes (e.g. sleep) are also killed
			try {
				if (proc.pid !== undefined) process.kill(-proc.pid, "SIGKILL");
			} catch (killErr: unknown) {
				if ((killErr as NodeJS.ErrnoException)?.code !== "ESRCH") {
					console.error("[sia-sandbox] process group kill failed:", (killErr as Error).message);
				}
				proc.kill("SIGKILL");
			}
		}, opts.timeout);

		proc.on("close", (code) => {
			clearTimeout(timer);
			try {
				rmSync(tmpDir, { recursive: true, force: true });
			} catch (e) {
				console.error("[sia-sandbox] cleanup failed:", (e as Error).message);
			}
			resolve({
				stdout,
				stderr,
				exitCode: code,
				timedOut,
				truncated: stdoutTruncated || stderrTruncated,
				runtimeMs: Date.now() - startMs,
			});
		});

		proc.on("error", (err) => {
			clearTimeout(timer);
			try {
				rmSync(tmpDir, { recursive: true, force: true });
			} catch (e) {
				console.error("[sia-sandbox] cleanup failed:", (e as Error).message);
			}
			resolve({
				stdout,
				stderr: err.message,
				exitCode: -1,
				timedOut,
				truncated: stdoutTruncated || stderrTruncated,
				runtimeMs: Date.now() - startMs,
			});
		});
	});
}
