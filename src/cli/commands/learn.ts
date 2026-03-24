// Module: learn — Full knowledge graph builder orchestrator.
//
// Usage:
//   sia learn                    Full rebuild (default)
//   sia learn --incremental      Only process changed files
//   sia learn --force            Skip snapshot restore, rebuild everything
//   sia learn --verbose          Phase-by-phase progress (default)
//   sia learn --quiet            Summary only
//   sia learn --interactive      Confirm after each phase

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRepoHash } from "@/capture/hook";
import {
	deleteProgress,
	type LearnProgress,
	readProgress,
	runWithRetry,
	writeProgress,
} from "@/cli/learn-progress";
import { getConfig, resolveSiaHome } from "@/shared/config";

export type Verbosity = "verbose" | "quiet" | "interactive";

export interface LearnOptions {
	cwd?: string;
	siaHome?: string;
	incremental?: boolean;
	force?: boolean;
	verbosity?: Verbosity;
}

export interface LearnResult {
	phasesCompleted: number[];
	phasesFailed: number[];
	codeEntities: number;
	codeFiles: number;
	codeCacheHits: number;
	docsIngested: number;
	docChunks: number;
	externalRefs: number;
	communities: number;
	skippedFiles: Array<{ path: string; error: string }>;
	durationMs: number;
}

function log(verbosity: Verbosity, msg: string): void {
	if (verbosity !== "quiet") {
		process.stderr.write(`${msg}\n`);
	}
}

export async function siaLearn(opts: LearnOptions = {}): Promise<LearnResult | null> {
	const start = Date.now();
	const cwd = resolve(opts.cwd ?? process.cwd());
	const siaHome = opts.siaHome ?? resolveSiaHome();
	const verbosity = opts.verbosity ?? "verbose";
	const config = getConfig(siaHome);

	const result: LearnResult = {
		phasesCompleted: [],
		phasesFailed: [],
		codeEntities: 0,
		codeFiles: 0,
		codeCacheHits: 0,
		docsIngested: 0,
		docChunks: 0,
		externalRefs: 0,
		communities: 0,
		skippedFiles: [],
		durationMs: 0,
	};

	// Check for resumable progress
	const existingProgress = readProgress(cwd);
	let phasesToSkip: Set<number> = new Set();
	if (existingProgress && !opts.force) {
		const repoHash = resolveRepoHash(cwd);
		if (existingProgress.repo_hash === repoHash) {
			phasesToSkip = new Set(existingProgress.phases_completed);
			log(
				verbosity,
				`[sia-learn] Resuming — phases ${[...phasesToSkip].join(", ")} already complete`,
			);
		}
	}

	// Initialize progress file
	const progress: LearnProgress = {
		started_at: existingProgress?.started_at ?? Date.now(),
		repo_hash: resolveRepoHash(cwd),
		branch: "",
		phases_completed: [...phasesToSkip],
		files_indexed: existingProgress?.files_indexed ?? 0,
		total_files: 0,
		last_checkpoint_at: Date.now(),
	};

	// Try to get current branch
	try {
		const { execFileSync } = await import("node:child_process");
		progress.branch = execFileSync("git", ["branch", "--show-current"], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		progress.branch = "unknown";
	}

	// --- Phase 0: Install (idempotent) ---
	if (!phasesToSkip.has(0)) {
		log(verbosity, "[sia-learn] Phase 0: Installing SIA...");
		const installResult = await runWithRetry("Phase 0: Install", async () => {
			const { siaInstall } = await import("@/cli/commands/install");
			await siaInstall({ cwd, siaHome });
		});
		if (installResult !== null) {
			result.phasesCompleted.push(0);
			progress.phases_completed.push(0);
			writeProgress(cwd, progress);
			log(verbosity, "[sia-learn] Phase 0: Done");
		} else {
			result.phasesFailed.push(0);
			// Install failure is fatal — can't continue without databases
			log(verbosity, "[sia-learn] Phase 0: FAILED — cannot continue without databases");
			result.durationMs = Date.now() - start;
			return result;
		}
	} else {
		result.phasesCompleted.push(0);
	}

	// --- Phase 0.5: Ensure embedding model is downloaded ---
	try {
		const { downloadModel } = await import("@/cli/commands/download-model");
		await downloadModel(siaHome);
	} catch (err) {
		log(verbosity, `[sia-learn] Model download failed (non-fatal): ${err}`);
	}

	// Open graph DB for remaining phases
	const { openGraphDb } = await import("@/graph/semantic-db");
	const repoHash = resolveRepoHash(cwd);
	const db = openGraphDb(repoHash, siaHome);

	try {
		// --- Phase 1: AST code indexing (delegates to siaReindex) ---
		if (!phasesToSkip.has(1)) {
			log(verbosity, "[sia-learn] Phase 1: Indexing code...");
			const indexResult = await runWithRetry("Phase 1: Code indexing", async () => {
				const { siaReindex } = await import("@/cli/commands/reindex");
				return siaReindex({ cwd, siaHome });
			});
			if (indexResult) {
				result.codeEntities = indexResult.entitiesCreated;
				result.codeFiles = indexResult.filesProcessed;
				result.codeCacheHits = indexResult.cacheHits;
				result.phasesCompleted.push(1);
				progress.phases_completed.push(1);
				progress.files_indexed = indexResult.filesProcessed;
				writeProgress(cwd, progress);
				log(
					verbosity,
					`[sia-learn] Phase 1: Done — ${indexResult.entitiesCreated} entities from ${indexResult.filesProcessed} files (${indexResult.cacheHits} cached)`,
				);
			} else {
				result.phasesFailed.push(1);
			}
		} else {
			result.phasesCompleted.push(1);
		}

		// --- Phase 2: Markdown doc ingestion ---
		if (!phasesToSkip.has(2)) {
			log(verbosity, "[sia-learn] Phase 2: Ingesting docs...");
			const docResult = await runWithRetry("Phase 2: Doc ingestion", async () => {
				const { discoverDocFiles } = await import("@/knowledge/discovery");
				const { ingestDocument } = await import("@/knowledge/ingest");
				const { detectExternalRefs } = await import("@/knowledge/external-refs");

				const docFiles = discoverDocFiles(cwd);
				let docsIngested = 0;
				let chunksCreated = 0;
				let refsFound = 0;

				for (const doc of docFiles) {
					try {
						// Incremental: skip if file hasn't changed
						if (opts.incremental && !opts.force) {
							const { statSync } = await import("node:fs");
							const fileMtime = statSync(doc.absolutePath).mtimeMs;
							const existing = await db.execute(
								`SELECT updated_at FROM graph_nodes
								 WHERE file_paths LIKE ? AND type = 'FileNode'
								 AND t_valid_until IS NULL AND archived_at IS NULL
								 LIMIT 1`,
								[`%${doc.relativePath}%`],
							);
							if (existing.rows.length > 0 && (existing.rows[0] as any).updated_at >= fileMtime) {
								continue; // Skip unchanged file
							}
						}

						const ingestResult = await ingestDocument(db, doc.absolutePath, doc.relativePath, {
							tag: doc.pattern.tag,
							trustTier: doc.pattern.trustTier as 1 | 2,
							packagePath: doc.packagePath,
						});
						docsIngested++;
						chunksCreated += ingestResult.chunksCreated;

						// Detect external refs in doc content
						try {
							const content = readFileSync(doc.absolutePath, "utf-8");
							const refs = detectExternalRefs(content);
							refsFound += refs.length;
						} catch {
							// Non-fatal — skip external ref detection for this file
						}
					} catch (err) {
						// Per-file error — log and continue
						const msg = err instanceof Error ? err.message : String(err);
						process.stderr.write(
							`[sia-learn] Warning: Failed to ingest ${doc.relativePath}: ${msg}\n`,
						);
					}
				}

				return { docsIngested, chunksCreated, refsFound };
			});

			if (docResult) {
				result.docsIngested = docResult.docsIngested;
				result.docChunks = docResult.chunksCreated;
				result.externalRefs = docResult.refsFound;
				result.phasesCompleted.push(2);
				progress.phases_completed.push(2);
				writeProgress(cwd, progress);
				log(
					verbosity,
					`[sia-learn] Phase 2: Done — ${docResult.chunksCreated} chunks from ${docResult.docsIngested} documents, ${docResult.refsFound} external refs`,
				);
			} else {
				result.phasesFailed.push(2);
			}
		} else {
			result.phasesCompleted.push(2);
		}

		// --- Phase 3: Community detection + summarization ---
		if (!phasesToSkip.has(3)) {
			log(verbosity, "[sia-learn] Phase 3: Detecting communities...");
			const communityResult = await runWithRetry("Phase 3: Community detection", async () => {
				const { detectCommunities } = await import("@/community/leiden");
				const { summarizeCommunities } = await import("@/community/summarize");

				const detectionResult = await detectCommunities(db);

				// Summarize if we have communities
				if (detectionResult.totalCommunities > 0) {
					await summarizeCommunities(db, { airGapped: config.airGapped ?? false });
				}

				return detectionResult;
			});

			if (communityResult) {
				result.communities = communityResult.totalCommunities;
				result.phasesCompleted.push(3);
				progress.phases_completed.push(3);
				writeProgress(cwd, progress);
				log(
					verbosity,
					`[sia-learn] Phase 3: Done — ${communityResult.totalCommunities} communities formed`,
				);
			} else {
				result.phasesFailed.push(3);
			}
		} else {
			result.phasesCompleted.push(3);
		}

		// --- Branch snapshot save (if Phase D.5 is available) ---
		try {
			// Check if branch_snapshots table exists
			await db.execute("SELECT 1 FROM branch_snapshots LIMIT 0");
			// Table exists — save snapshot for current branch
			const { createBranchSnapshot } = await import("@/graph/snapshots");
			const { execFileSync } = await import("node:child_process");
			const branch = execFileSync("git", ["branch", "--show-current"], {
				cwd,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim();
			const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
				cwd,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim();
			if (branch) {
				await createBranchSnapshot(db, branch, commit);
				log(verbosity, `[sia-learn] Saved snapshot for branch '${branch}' at ${commit}`);
			}
		} catch {
			// branch_snapshots table doesn't exist — Phase D.5 not implemented yet, skip silently
		}

		// --- Summary ---
		result.durationMs = Date.now() - start;
		deleteProgress(cwd); // Clean finish

		const summary = `
=== SIA Learn Complete ===
Code entities:  ${result.codeEntities} (${result.codeFiles} files, ${result.codeCacheHits} cached)
Doc chunks:     ${result.docChunks} (${result.docsIngested} documents)
External refs:  ${result.externalRefs}
Communities:    ${result.communities}
Duration:       ${(result.durationMs / 1000).toFixed(1)}s
${result.phasesFailed.length > 0 ? `Failed phases: ${result.phasesFailed.join(", ")}` : ""}
${result.skippedFiles.length > 0 ? `Skipped files:  ${result.skippedFiles.length}` : ""}`;

		process.stderr.write(`${summary.trim()}\n`);

		return result;
	} finally {
		await db.close();
	}
}
