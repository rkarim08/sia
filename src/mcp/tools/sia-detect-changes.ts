// Module: sia-detect-changes — Map git diff output to knowledge graph entities

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SiaDb } from "@/graph/db-interface";

const execFileAsync = promisify(execFile);

export interface DetectChangesInput {
	scope?: string; // "HEAD~1..HEAD" or "main..feature-branch"
	compare?: string;
}

export interface ChangedFileEntity {
	id: string;
	name: string;
	type: string;
}

export interface ChangedFile {
	path: string;
	status: "modified" | "added" | "deleted";
	entities: ChangedFileEntity[];
}

export interface DetectChangesResult {
	files_changed: ChangedFile[];
	total_entities_affected: number;
}

/** Type alias for the git diff runner; injectable for testing. */
export type GitDiffRunner = (scope: string) => Promise<string>;

/** Default git diff runner that shells out to git. */
async function defaultGitDiffRunner(scope: string): Promise<string> {
	const { stdout } = await execFileAsync("git", ["diff", "--name-status", scope]);
	return stdout;
}

/** Parse `git diff --name-status` output into structured file changes. */
export function parseGitDiffOutput(
	output: string,
): Array<{ path: string; status: "modified" | "added" | "deleted" }> {
	const lines = output.trim().split("\n").filter(Boolean);
	const results: Array<{ path: string; status: "modified" | "added" | "deleted" }> = [];

	for (const line of lines) {
		const parts = line.split("\t");
		if (parts.length < 2) continue;

		const statusCode = parts[0].charAt(0);
		let status: "modified" | "added" | "deleted";
		let path: string;

		switch (statusCode) {
			case "M":
				status = "modified";
				path = parts[1];
				break;
			case "A":
				status = "added";
				path = parts[1];
				break;
			case "D":
				status = "deleted";
				path = parts[1];
				break;
			case "R":
				// Rename: use the new path
				status = "modified";
				path = parts[2] ?? parts[1];
				break;
			case "C":
				// Copy: treat as added
				status = "added";
				path = parts[2] ?? parts[1];
				break;
			default:
				status = "modified";
				path = parts[1];
		}

		results.push({ path, status });
	}

	return results;
}

/**
 * Detect changed files from a git diff scope and map them to knowledge graph entities.
 *
 * @param db The graph database to query for entities
 * @param input The scope and options
 * @param gitDiffRunner Optional injectable runner for testing (defaults to shelling out to git)
 */
export async function handleSiaDetectChanges(
	db: SiaDb,
	input: DetectChangesInput,
	gitDiffRunner?: GitDiffRunner,
): Promise<DetectChangesResult> {
	const scope = input.scope ?? input.compare ?? "HEAD~1..HEAD";
	const runner = gitDiffRunner ?? defaultGitDiffRunner;

	let diffOutput: string;
	try {
		diffOutput = await runner(scope);
	} catch {
		return { files_changed: [], total_entities_affected: 0 };
	}

	const changedFiles = parseGitDiffOutput(diffOutput);
	if (changedFiles.length === 0) {
		return { files_changed: [], total_entities_affected: 0 };
	}

	let totalEntities = 0;
	const filesChanged: ChangedFile[] = [];

	for (const file of changedFiles) {
		// Query entities whose file_paths contain this path
		const result = await db.execute(
			`SELECT id, name, type
			 FROM graph_nodes
			 WHERE file_paths LIKE ?
			   AND t_valid_until IS NULL
			   AND archived_at IS NULL`,
			[`%${file.path}%`],
		);

		const entities: ChangedFileEntity[] = (
			result.rows as Array<{ id: string; name: string; type: string }>
		).map((row) => ({
			id: row.id,
			name: row.name,
			type: row.type,
		}));

		totalEntities += entities.length;
		filesChanged.push({
			path: file.path,
			status: file.status,
			entities,
		});
	}

	return {
		files_changed: filesChanged,
		total_entities_affected: totalEntities,
	};
}
