import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ExecuteOptions {
	language: string;
	code: string;
	timeoutMs: number;
	env?: Record<string, string>;
}

export interface ExecuteResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
}

const RUNTIME_MAP: Record<string, string> = {
	python: "python3",
	javascript: "node",
	typescript: "bun",
	ruby: "ruby",
	bash: "bash",
	lua: "lua",
	perl: "perl",
};

const EXTENSION_MAP: Record<string, string> = {
	python: "py",
	javascript: "js",
	typescript: "ts",
	ruby: "rb",
	bash: "sh",
	lua: "lua",
	perl: "pl",
};

export async function executeSubprocess(opts: ExecuteOptions): Promise<ExecuteResult> {
	const { language, code, timeoutMs, env } = opts;

	const runtime = RUNTIME_MAP[language] ?? language;
	const ext = EXTENSION_MAP[language] ?? "txt";

	const tmpDir = mkdtempSync(join(tmpdir(), "sia-sandbox-"));
	const codePath = join(tmpDir, `code.${ext}`);

	writeFileSync(codePath, code, "utf-8");

	return new Promise<ExecuteResult>((resolve) => {
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];
		let timedOut = false;

		// For typescript, bun needs "run" subcommand
		const args = language === "typescript" ? ["run", codePath] : [codePath];

		const proc = spawn(runtime, args, {
			env: env ?? (process.env as Record<string, string>),
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});

		proc.stdout.on("data", (chunk: Buffer) => {
			stdoutChunks.push(chunk.toString());
		});

		proc.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk.toString());
		});

		const timer = setTimeout(() => {
			timedOut = true;
			// Kill the entire process group (detached) to ensure child processes die too
			try {
				if (proc.pid) process.kill(-proc.pid, "SIGKILL");
			} catch {
				proc.kill("SIGKILL");
			}
		}, timeoutMs);

		proc.on("close", (code) => {
			clearTimeout(timer);
			rmSync(tmpDir, { recursive: true, force: true });
			resolve({
				stdout: stdoutChunks.join(""),
				stderr: stderrChunks.join(""),
				exitCode: code ?? -1,
				timedOut,
			});
		});

		proc.on("error", (err) => {
			clearTimeout(timer);
			rmSync(tmpDir, { recursive: true, force: true });
			resolve({
				stdout: stdoutChunks.join(""),
				stderr: err.message,
				exitCode: -1,
				timedOut,
			});
		});
	});
}
