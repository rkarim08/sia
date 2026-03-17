// Module: install — sia install command implementation
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { openBridgeDb } from "@/graph/bridge-db";
import { openMetaDb, registerRepo } from "@/graph/meta-db";
import { openEpisodicDb, openGraphDb } from "@/graph/semantic-db";
import { SIA_HOME, writeConfig } from "@/shared/config";

/** Result returned by siaInstall on success. */
export interface SiaInstallResult {
	repoHash: string;
	siaHome: string;
	dbsInitialized: boolean;
}

/**
 * Walk up from `startDir` looking for a `.git` directory.
 * Returns the directory containing `.git`, or null if none found.
 */
function findRepoRoot(startDir: string): string | null {
	let dir = resolve(startDir);
	const root = resolve("/");
	while (dir !== root) {
		if (existsSync(join(dir, ".git"))) {
			return dir;
		}
		const parent = resolve(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}
	// Check root as well
	if (existsSync(join(dir, ".git"))) {
		return dir;
	}
	return null;
}

/**
 * Install Sia for a repository.
 *
 * Detects the repo root, initializes all databases, registers the repo,
 * writes default config, copies the CLAUDE.md template, and creates the
 * ast-cache directory.
 */
export async function siaInstall(opts?: {
	cwd?: string;
	siaHome?: string;
}): Promise<SiaInstallResult> {
	const cwd = opts?.cwd ?? process.cwd();
	const siaHome = opts?.siaHome ?? SIA_HOME;

	// (a) Detect repo root
	const repoRoot = findRepoRoot(cwd);
	if (!repoRoot) {
		throw new Error(`No .git directory found from ${cwd}`);
	}

	// (b) Compute repo hash
	const resolvedPath = resolve(repoRoot);
	const repoHash = createHash("sha256").update(resolvedPath).digest("hex");

	// (c) Create repo directory
	const repoDir = join(siaHome, "repos", repoHash);
	mkdirSync(repoDir, { recursive: true });

	// (d) Initialize all 4 databases, then close each
	const graphDb = openGraphDb(repoHash, siaHome);
	await graphDb.close();

	const episodicDb = openEpisodicDb(repoHash, siaHome);
	await episodicDb.close();

	const metaDb = openMetaDb(siaHome);

	// (e) Register repo in meta.db
	await registerRepo(metaDb, resolvedPath);
	await metaDb.close();

	const bridgeDb = openBridgeDb(siaHome);
	await bridgeDb.close();

	// (f) Write default config if absent
	const configPath = join(siaHome, "config.json");
	if (!existsSync(configPath)) {
		writeConfig({}, siaHome);
	}

	// (g) Copy CLAUDE.md template to project root
	writeClaude(repoRoot, resolvedPath);

	// (h) Create ast-cache directory
	const astCacheDir = join(siaHome, "ast-cache", repoHash);
	mkdirSync(astCacheDir, { recursive: true });

	// (i) Print success message
	console.log(`Sia installed successfully.`);
	console.log(`  Repo hash: ${repoHash}`);
	console.log(`  Sia home:  ${siaHome}`);
	console.log(`  Repo path: ${resolvedPath}`);

	// (j) Return result
	return { repoHash, siaHome, dbsInitialized: true };
}

/** End-of-generated-block marker used in CLAUDE.md */
const END_MARKER = "<!-- END GENERATED BLOCK -->";

/**
 * Read the CLAUDE.md template, substitute placeholders, and write to project root.
 * - If CLAUDE.md does not exist: write the full file.
 * - If CLAUDE.md exists and contains the END_MARKER: replace everything up to and
 *   including the marker, preserving user content after it.
 * - If CLAUDE.md exists but has no END_MARKER: skip (do not overwrite).
 */
function writeClaude(repoRoot: string, resolvedPath: string): void {
	const templatePath = resolve(import.meta.dirname, "../../agent/claude-md-template.md");
	if (!existsSync(templatePath)) {
		return;
	}

	const template = readFileSync(templatePath, "utf-8");
	const pkgPath = resolve(import.meta.dirname, "../../../package.json");
	let version = "0.0.0";
	if (existsSync(pkgPath)) {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
		version = pkg.version ?? version;
	}

	const repoName = basename(resolvedPath);
	const rendered = template
		.replace(/\{\{SIA_VERSION\}\}/g, version)
		.replace(/\{\{GENERATED_AT\}\}/g, new Date().toISOString())
		.replace(/\{\{WORKSPACE_NAME\}\}/g, repoName);

	const claudePath = join(repoRoot, "CLAUDE.md");

	if (!existsSync(claudePath)) {
		// File does not exist — write fresh
		writeFileSync(claudePath, rendered, "utf-8");
		return;
	}

	// File exists — check for END_MARKER
	const existing = readFileSync(claudePath, "utf-8");
	const markerIdx = existing.indexOf(END_MARKER);

	if (markerIdx === -1) {
		// No marker found — skip to avoid overwriting user content
		return;
	}

	// Replace everything up to and including the marker, keep user content after
	const userContent = existing.slice(markerIdx + END_MARKER.length);
	writeFileSync(claudePath, rendered + userContent, "utf-8");
}
