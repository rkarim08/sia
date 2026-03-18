// Module: csharp-project — C# code entity extraction + .csproj dependency extraction

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { CandidateFact } from "@/capture/types";

// ─── Phase 1: C# code patterns ──────────────────────────────────────────────

/** Regex for C# methods (access modifier required). Capture group 2 = name.
 *  Return type allows generic forms like Task<string> or List<T>. */
const METHOD_RE =
	/(public|private|protected|internal|static|async|virtual|override|abstract)\s+\w+(?:<[^>]*>)?\s+(\w+)\s*\(/gm;

/** Regex for C# class / interface / struct / enum / record declarations. Capture group 2 = name. */
const CLASS_RE = /(class|interface|struct|enum|record)\s+(\w+)/gm;

/** Regex for C# auto-properties: `modifier type Name { get; set; }` on a single line.
 *  [^}\n] prevents crossing into multi-line class bodies. */
const PROPERTY_RE =
	/(public|private|protected|internal)\s+[\w<>[\]?]+\s+(\w+)\s*\{[^}\n]*(?:get|set)[^}\n]*\}/gm;

/** Regex for C# using statements. Capture group 1 = namespace. */
const USING_RE = /^using\s+([\w.]+)\s*;/gm;

// ─── Phase 2: .csproj patterns ───────────────────────────────────────────────

/** ProjectReference Include="..." */
const PROJECT_REF_RE = /<ProjectReference\s+Include="([^"]+)"/g;

/** PackageReference Include="..." with optional Version="..." */
const PACKAGE_REF_RE = /<PackageReference\s+Include="([^"]+)"(?:[^/]*?Version="([^"]+)")?/g;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Walk UP from startDir looking for a .csproj file in each directory.
 * Stops at repoRoot or after maxLevels iterations.
 */
function findCsprojFile(startDir: string, repoRoot: string, maxLevels = 5): string | null {
	let current = startDir;

	for (let level = 0; level < maxLevels; level++) {
		let entries: string[] = [];
		try {
			entries = readdirSync(current) as string[];
		} catch {
			return null;
		}

		const csproj = entries.find((e) => e.endsWith(".csproj"));
		if (csproj) {
			const fullPath = join(current, csproj);
			if (existsSync(fullPath)) {
				return fullPath;
			}
		}

		if (current === repoRoot) break;

		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return null;
}

/**
 * Extract C# code entities from .cs source and project dependencies from an
 * adjacent .csproj file.
 *
 * Phase 1: methods, classes/interfaces/structs/enums/records, properties, usings.
 * Phase 2: walks up directories to find a .csproj, then extracts ProjectReference
 *          and PackageReference entries.
 */
export function extractCSharpProject(
	content: string,
	filePath: string,
	repoRoot?: string,
): CandidateFact[] {
	if (extname(filePath).toLowerCase() !== ".cs") return [];
	if (!content) return [];

	const base = basename(filePath);
	const facts: CandidateFact[] = [];
	const seen = new Set<string>();

	// ── Phase 1: code entity extraction ──────────────────────────────────────

	// Methods
	{
		const re = new RegExp(METHOD_RE.source, METHOD_RE.flags);
		let m = re.exec(content);
		while (m !== null) {
			const name = m[2];
			if (name) {
				const key = `method:${name}`;
				if (!seen.has(key)) {
					seen.add(key);
					facts.push({
						type: "CodeEntity",
						name,
						content: m[0].trim(),
						summary: `method ${name} in ${base}`,
						tags: ["csharp", "method"],
						file_paths: [filePath],
						trust_tier: 2,
						confidence: 0.92,
					});
				}
			}
			m = re.exec(content);
		}
	}

	// Classes, interfaces, structs, enums, records
	{
		const re = new RegExp(CLASS_RE.source, CLASS_RE.flags);
		let m = re.exec(content);
		while (m !== null) {
			const kind = m[1];
			const name = m[2];
			if (name && kind) {
				const key = `class:${name}`;
				if (!seen.has(key)) {
					seen.add(key);
					facts.push({
						type: "CodeEntity",
						name,
						content: m[0].trim(),
						summary: `${kind} ${name} in ${base}`,
						tags: ["csharp", "class"],
						file_paths: [filePath],
						trust_tier: 2,
						confidence: 0.92,
					});
				}
			}
			m = re.exec(content);
		}
	}

	// Properties
	{
		const re = new RegExp(PROPERTY_RE.source, PROPERTY_RE.flags);
		let m = re.exec(content);
		while (m !== null) {
			const name = m[2];
			if (name) {
				const key = `property:${name}`;
				if (!seen.has(key)) {
					seen.add(key);
					facts.push({
						type: "CodeEntity",
						name,
						content: m[0].trim(),
						summary: `property ${name} in ${base}`,
						tags: ["csharp", "property"],
						file_paths: [filePath],
						trust_tier: 2,
						confidence: 0.92,
					});
				}
			}
			m = re.exec(content);
		}
	}

	// Using statements
	{
		const re = new RegExp(USING_RE.source, USING_RE.flags);
		let m = re.exec(content);
		while (m !== null) {
			const name = m[1];
			if (name) {
				const key = `using:${name}`;
				if (!seen.has(key)) {
					seen.add(key);
					facts.push({
						type: "CodeEntity",
						name,
						content: m[0].trim(),
						summary: `using ${name} in ${base}`,
						tags: ["csharp", "using"],
						file_paths: [filePath],
						trust_tier: 2,
						confidence: 0.92,
					});
				}
			}
			m = re.exec(content);
		}
	}

	// ── Phase 2: .csproj dependency extraction ────────────────────────────────

	const searchRoot = repoRoot ?? dirname(filePath);
	const csprojPath = findCsprojFile(dirname(filePath), searchRoot);

	if (csprojPath) {
		let csprojContent: string;
		try {
			csprojContent = readFileSync(csprojPath, "utf8") as string;
		} catch {
			return facts;
		}

		// ProjectReference entries
		{
			const re = new RegExp(PROJECT_REF_RE.source, PROJECT_REF_RE.flags);
			let m = re.exec(csprojContent);
			while (m !== null) {
				const include = m[1];
				if (include) {
					facts.push({
						type: "Dependency",
						name: include,
						content: m[0].trim(),
						summary: `ProjectReference ${include} in ${basename(csprojPath)}`,
						tags: ["project-reference", "csharp"],
						file_paths: [filePath, csprojPath],
						trust_tier: 2,
						confidence: 0.9,
						extraction_method: "csharp-project",
					});
				}
				m = re.exec(csprojContent);
			}
		}

		// PackageReference entries
		{
			const re = new RegExp(PACKAGE_REF_RE.source, PACKAGE_REF_RE.flags);
			let m = re.exec(csprojContent);
			while (m !== null) {
				const pkgName = m[1];
				const version = m[2];
				if (pkgName) {
					const contentStr = version ? `${pkgName} ${version}` : pkgName;
					facts.push({
						type: "Dependency",
						name: pkgName,
						content: contentStr,
						summary: version
							? `PackageReference ${pkgName} v${version} in ${basename(csprojPath)}`
							: `PackageReference ${pkgName} in ${basename(csprojPath)}`,
						tags: ["package-reference", "csharp", "nuget"],
						file_paths: [filePath, csprojPath],
						trust_tier: 2,
						confidence: 0.9,
						extraction_method: "csharp-project",
					});
				}
				m = re.exec(csprojContent);
			}
		}
	}

	return facts;
}
