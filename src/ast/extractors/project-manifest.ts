// Module: project-manifest — Cargo.toml/go.mod/pyproject.toml dependency extraction

import { basename } from "node:path";
import type { CandidateFact } from "@/capture/types";

/**
 * Extract dependency / workspace-member facts from project manifest files.
 *
 * Supported formats:
 * - Cargo.toml: `members = ["pkg-a", "pkg-b"]` under [workspace]
 * - go.mod: `replace ... => <local-path>` directives
 * - pyproject.toml: `path = "..."` dependency references
 */
export function extractManifest(content: string, filePath: string): CandidateFact[] {
	const file = basename(filePath).toLowerCase();

	if (file === "cargo.toml") {
		return extractCargoMembers(content, filePath);
	}
	if (file === "go.mod") {
		return extractGoModReplace(content, filePath);
	}
	if (file === "pyproject.toml" || file === "setup.py" || file === "setup.cfg") {
		return extractPyprojectPaths(content, filePath);
	}

	return [];
}

/** Extract workspace members from Cargo.toml */
function extractCargoMembers(content: string, filePath: string): CandidateFact[] {
	const facts: CandidateFact[] = [];

	// Match members = ["a", "b", "c"] -- possibly multiline
	const membersRe = /members\s*=\s*\[([^\]]*)\]/gs;
	let match: RegExpExecArray | null = membersRe.exec(content);
	while (match !== null) {
		const block = match[1];
		const entryRe = /"([^"]+)"/g;
		let entry: RegExpExecArray | null = entryRe.exec(block);
		while (entry !== null) {
			facts.push({
				type: "Dependency",
				name: entry[1],
				content: `workspace member: ${entry[1]}`,
				summary: `Cargo workspace member: ${entry[1]}`,
				tags: ["workspace-member"],
				file_paths: [filePath],
				trust_tier: 2,
				confidence: 0.85,
				extraction_method: "manifest",
			});
			entry = entryRe.exec(block);
		}
		match = membersRe.exec(content);
	}

	return facts;
}

/** Extract replace directives from go.mod */
function extractGoModReplace(content: string, filePath: string): CandidateFact[] {
	const facts: CandidateFact[] = [];

	// replace <module> => <local-path>
	const replaceRe = /replace\s+\S+\s+=>\s+(\S+)/gm;
	let match: RegExpExecArray | null = replaceRe.exec(content);
	while (match !== null) {
		const localPath = match[1];
		facts.push({
			type: "Dependency",
			name: localPath,
			content: match[0],
			summary: `go.mod replace: ${localPath}`,
			tags: ["replace"],
			file_paths: [filePath],
			trust_tier: 2,
			confidence: 0.85,
			extraction_method: "manifest",
		});
		match = replaceRe.exec(content);
	}

	return facts;
}

/** Extract path dependencies from pyproject.toml */
function extractPyprojectPaths(content: string, filePath: string): CandidateFact[] {
	const facts: CandidateFact[] = [];

	// path = "some/local/path"
	const pathRe = /path\s*=\s*"([^"]+)"/g;
	let match: RegExpExecArray | null = pathRe.exec(content);
	while (match !== null) {
		const localPath = match[1];
		facts.push({
			type: "Dependency",
			name: localPath,
			content: match[0],
			summary: `pyproject path dependency: ${localPath}`,
			tags: ["path-dependency"],
			file_paths: [filePath],
			trust_tier: 2,
			confidence: 0.85,
			extraction_method: "manifest",
		});
		match = pathRe.exec(content);
	}

	return facts;
}
