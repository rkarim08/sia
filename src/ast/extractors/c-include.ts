// Module: c-include — C/C++ #include resolution with compile_commands.json support

import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { CandidateFact } from "@/capture/types";

/** A single entry in compile_commands.json */
interface CompileCommand {
	file: string;
	command?: string;
	arguments?: string[];
	directory?: string;
}

/**
 * Parse `-I<path>` and `-I <path>` flags from a compilation command string.
 */
function extractIncludePathsFromCommand(command: string): string[] {
	const paths: string[] = [];
	const re = /-I\s*([^\s]+)/g;
	let match = re.exec(command);
	while (match !== null) {
		paths.push(match[1]);
		match = re.exec(command);
	}
	return paths;
}

/**
 * Load compile_commands.json from repoRoot and find include paths for the
 * given filePath.  Returns null if the file does not exist, [] if found but
 * no matching entry or no -I flags.
 */
function loadIncludePaths(repoRoot: string, filePath: string): string[] | null {
	const ccPath = join(repoRoot, "compile_commands.json");
	if (!existsSync(ccPath)) {
		return null;
	}

	try {
		const raw = readFileSync(ccPath, "utf8") as string;
		const commands: CompileCommand[] = JSON.parse(raw) as CompileCommand[];

		const entry = commands.find((cmd) => {
			const dir = cmd.directory ?? "";
			const resolvedFile = dir ? join(dir, cmd.file) : cmd.file;
			return resolvedFile === filePath || cmd.file === filePath;
		});

		if (!entry) {
			return [];
		}

		if (entry.arguments && entry.arguments.length > 0) {
			const paths: string[] = [];
			for (let i = 0; i < entry.arguments.length; i++) {
				const arg = entry.arguments[i];
				if (arg === "-I" && i + 1 < entry.arguments.length) {
					paths.push(entry.arguments[i + 1]);
					i++;
				} else if (arg.startsWith("-I") && arg.length > 2) {
					paths.push(arg.slice(2));
				}
			}
			return paths;
		}

		if (entry.command) {
			return extractIncludePathsFromCommand(entry.command);
		}

		return [];
	} catch {
		return [];
	}
}

/** Determine language tag based on file extension. */
function langFromPath(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	if (ext === ".c" || ext === ".h") return "c";
	return "cpp";
}

/**
 * Extract `#include` directives from C/C++ source content.
 *
 * System includes (`<...>`) → confidence 0.80, tag `system-include`.
 * Local includes (`"..."`) → resolved via compile_commands -I paths, then
 * same-directory, then repo-root fallback.
 * Resolved → confidence 0.85; unresolved → confidence 0.70.
 */
export function extractCIncludes(
	content: string,
	filePath: string,
	repoRoot?: string,
): CandidateFact[] {
	if (!content) return [];

	const includeRe = /^\s*#\s*include\s*(?:<([^>]+)>|"([^"]+)")/gm;
	const directives: Array<{ name: string; isSystem: boolean; raw: string }> = [];
	let m = includeRe.exec(content);
	while (m !== null) {
		if (m[1] !== undefined) {
			directives.push({ name: m[1], isSystem: true, raw: m[0].trim() });
		} else if (m[2] !== undefined) {
			directives.push({ name: m[2], isSystem: false, raw: m[0].trim() });
		}
		m = includeRe.exec(content);
	}

	if (directives.length === 0) return [];

	const lang = langFromPath(filePath);

	let includePaths: string[] = [];

	if (repoRoot) {
		const loaded = loadIncludePaths(repoRoot, filePath);
		if (loaded === null) {
			console.warn(
				`[c-include] compile_commands.json not found in ${repoRoot}; falling back to directory-based resolution`,
			);
		} else {
			includePaths = loaded;
		}
	}

	const facts: CandidateFact[] = [];

	for (const directive of directives) {
		if (directive.isSystem) {
			facts.push({
				type: "CodeEntity",
				name: directive.name,
				content: directive.raw,
				summary: `System include: ${directive.name} in ${filePath}`,
				tags: ["include", "system-include", lang],
				file_paths: [filePath],
				trust_tier: 2,
				confidence: 0.8,
				extraction_method: "c-include",
			});
		} else {
			let resolvedPath: string | undefined;

			for (const ip of includePaths) {
				const candidate = join(ip, directive.name);
				if (existsSync(candidate)) {
					resolvedPath = candidate;
					break;
				}
			}

			if (!resolvedPath) {
				const candidate = join(dirname(filePath), directive.name);
				if (existsSync(candidate)) {
					resolvedPath = candidate;
				}
			}

			if (!resolvedPath && repoRoot) {
				const candidate = join(repoRoot, directive.name);
				if (existsSync(candidate)) {
					resolvedPath = candidate;
				}
			}

			const confidence = resolvedPath ? 0.85 : 0.7;
			const filePaths = resolvedPath ? [filePath, resolvedPath] : [filePath];

			facts.push({
				type: "CodeEntity",
				name: directive.name,
				content: directive.raw,
				summary: resolvedPath
					? `Local include: ${directive.name} -> ${resolvedPath}`
					: `Local include: ${directive.name} (unresolved) in ${filePath}`,
				tags: ["include", lang],
				file_paths: filePaths,
				trust_tier: 2,
				confidence,
				extraction_method: "c-include",
			});
		}
	}

	return facts;
}
