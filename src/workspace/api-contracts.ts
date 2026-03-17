// Module: api-contracts — API contract auto-detection scanner
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { SiaDb } from "@/graph/db-interface";

export interface DetectedContract {
  type: string;
  specPath: string;
}

/**
 * Scan a repository directory for API contracts.
 * Returns detected contracts — does NOT write to the database.
 */
export async function detectApiContracts(repoPath: string): Promise<DetectedContract[]> {
  const contracts: DetectedContract[] = [];

  // OpenAPI / Swagger
  for (const name of ["openapi.yaml", "openapi.json", "swagger.yaml", "swagger.json"]) {
    if (existsSync(join(repoPath, name))) {
      contracts.push({ type: "openapi", specPath: name });
    }
  }

  // GraphQL — root level
  const rootFiles = safeReaddir(repoPath);
  for (const entry of rootFiles) {
    if (entry.isFile() && entry.name.endsWith(".graphql")) {
      contracts.push({ type: "graphql", specPath: entry.name });
    }
  }
  // GraphQL — recursive (depth 3)
  findFilesRecursive(repoPath, ".graphql", contracts, repoPath, 3);

  // TypeScript project references
  const tsconfigPath = join(repoPath, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    try {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
      if (Array.isArray(tsconfig.references)) {
        for (const ref of tsconfig.references) {
          if (typeof ref.path === "string") {
            contracts.push({ type: "ts-reference", specPath: ref.path });
          }
        }
      }
    } catch { /* ignore */ }
  }

  // C# .csproj ProjectReference
  for (const entry of rootFiles) {
    if (entry.isFile() && entry.name.endsWith(".csproj")) {
      try {
        const content = readFileSync(join(repoPath, entry.name), "utf-8");
        const refPattern = /ProjectReference\s+Include="([^"]+)"/g;
        let match: RegExpExecArray | null = refPattern.exec(content);
        while (match !== null) {
          contracts.push({ type: "csproj-reference", specPath: match[1] });
          match = refPattern.exec(content);
        }
      } catch { /* ignore */ }
    }
  }

  // Cargo.toml workspace members
  const cargoPath = join(repoPath, "Cargo.toml");
  if (existsSync(cargoPath)) {
    try {
      const content = readFileSync(cargoPath, "utf-8");
      const membersMatch = content.match(/members\s*=\s*\[([^\]]+)\]/);
      if (membersMatch) {
        const members = membersMatch[1]
          .split(",")
          .map((m) => m.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
        for (const member of members) {
          contracts.push({ type: "cargo-dependency", specPath: member });
        }
      }
    } catch { /* ignore */ }
  }

  // go.mod replace directives
  const goModPath = join(repoPath, "go.mod");
  if (existsSync(goModPath)) {
    try {
      const content = readFileSync(goModPath, "utf-8");
      const replacePattern = /replace\s+\S+\s+=>\s+(\S+)/g;
      let match: RegExpExecArray | null = replacePattern.exec(content);
      while (match !== null) {
        contracts.push({ type: "go-mod-replace", specPath: match[1] });
        match = replacePattern.exec(content);
      }
    } catch { /* ignore */ }
  }

  // pyproject.toml path dependencies
  const pyprojectPath = join(repoPath, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    try {
      const content = readFileSync(pyprojectPath, "utf-8");
      const pathPattern = /path\s*=\s*"([^"]+)"/g;
      let match: RegExpExecArray | null = pathPattern.exec(content);
      while (match !== null) {
        contracts.push({ type: "python-path-dep", specPath: match[1] });
        match = pathPattern.exec(content);
      }
    } catch { /* ignore */ }
  }

  // Gradle settings.gradle / settings.gradle.kts
  for (const name of ["settings.gradle", "settings.gradle.kts"]) {
    const gradlePath = join(repoPath, name);
    if (existsSync(gradlePath)) {
      try {
        const content = readFileSync(gradlePath, "utf-8");
        const includePattern = /include\s*\(?([^\n)]+)\)?/g;
        let lineMatch: RegExpExecArray | null = includePattern.exec(content);
        while (lineMatch !== null) {
          const parts = lineMatch[1].split(",");
          for (const part of parts) {
            const cleaned = part
              .trim()
              .replace(/^\(/, "").replace(/\)$/, "")
              .replace(/^['"]/, "").replace(/['"]$/, "");
            if (cleaned.startsWith(":")) {
              contracts.push({ type: "gradle-project", specPath: cleaned.slice(1).replace(/:/g, "/") });
            }
          }
          lineMatch = includePattern.exec(content);
        }
      } catch { /* ignore */ }
    }
  }

  return contracts;
}

function safeReaddir(dirPath: string) {
  try {
    return readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Recursively find files by extension, avoiding duplicates with root-level scan. */
function findFilesRecursive(
  dir: string,
  ext: string,
  contracts: DetectedContract[],
  rootDir: string,
  maxDepth: number,
): void {
  if (maxDepth <= 0) return;
  const entries = safeReaddir(dir);
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) {
      const childDir = join(dir, entry.name);
      const childEntries = safeReaddir(childDir);
      for (const child of childEntries) {
        if (child.isFile() && child.name.endsWith(ext)) {
          const relPath = relative(rootDir, join(childDir, child.name));
          // Don't duplicate root-level files
          if (!contracts.some((c) => c.specPath === relPath)) {
            contracts.push({ type: "graphql", specPath: relPath });
          }
        }
      }
      findFilesRecursive(childDir, ext, contracts, rootDir, maxDepth - 1);
    }
  }
}

/**
 * Write detected contracts to api_contracts in meta.db with trust_tier=2.
 * Idempotent: upserts by (provider_repo_id, contract_type, spec_path).
 */
export async function writeDetectedContracts(
  db: SiaDb,
  providerRepoId: string,
  contracts: DetectedContract[],
): Promise<void> {
  const now = Date.now();

  for (const contract of contracts) {
    const existing = await db.execute(
      `SELECT id FROM api_contracts
       WHERE provider_repo_id = ? AND contract_type = ? AND spec_path = ?`,
      [providerRepoId, contract.type, contract.specPath],
    );

    if (existing.rows.length > 0) {
      await db.execute(
        "UPDATE api_contracts SET detected_at = ? WHERE id = ?",
        [now, existing.rows[0]?.id as string],
      );
      continue;
    }

    await db.execute(
      `INSERT INTO api_contracts (id, provider_repo_id, consumer_repo_id, contract_type, spec_path, trust_tier, detected_at)
       VALUES (?, ?, ?, ?, ?, 2, ?)`,
      [randomUUID(), providerRepoId, providerRepoId, contract.type, contract.specPath, now],
    );
  }
}
