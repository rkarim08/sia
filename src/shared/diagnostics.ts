// Module: diagnostics — Reusable diagnostic check functions for sia_doctor

import { spawn } from "node:child_process";
import type { SiaDb } from "@/graph/db-interface";

// ---------------------------------------------------------------------------
// DiagnosticCheck interface
// ---------------------------------------------------------------------------

export interface DiagnosticCheck {
	name: string;
	category: string;
	status: "ok" | "warn" | "error";
	message: string;
	version?: string;
}

// ---------------------------------------------------------------------------
// checkRuntime — spawn <binary> --version with 5s timeout
// ---------------------------------------------------------------------------

export async function checkRuntime(name: string, binary: string): Promise<DiagnosticCheck> {
	return new Promise((resolve) => {
		let timedOut = false;
		let stdout = "";
		let stderr = "";

		const child = spawn(binary, ["--version"], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, 5000);

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("close", (code) => {
			clearTimeout(timer);

			if (timedOut) {
				resolve({
					name,
					category: "runtimes",
					status: "warn",
					message: `${binary} timed out after 5s`,
				});
				return;
			}

			if (code === 0 || stdout.length > 0 || stderr.length > 0) {
				// Many tools print version to stderr (e.g. go, rustc)
				const raw = (stdout || stderr).trim();
				// Extract first line as version string
				const version = raw.split("\n")[0]?.trim() ?? raw;

				if (code === 0 || version.length > 0) {
					resolve({
						name,
						category: "runtimes",
						status: "ok",
						message: `${binary} is available`,
						version: version || undefined,
					});
					return;
				}
			}

			resolve({
				name,
				category: "runtimes",
				status: "warn",
				message: `${binary} not found or returned exit code ${code}`,
			});
		});

		child.on("error", () => {
			clearTimeout(timer);
			resolve({
				name,
				category: "runtimes",
				status: "warn",
				message: `${binary} not found`,
			});
		});
	});
}

// ---------------------------------------------------------------------------
// checkFts5 — verify FTS5 virtual table is accessible
// ---------------------------------------------------------------------------

export async function checkFts5(db: SiaDb): Promise<DiagnosticCheck> {
	// Try graph_nodes_fts first (v5 schema), fallback to entities_fts (v1 schema)
	for (const table of ["graph_nodes_fts", "entities_fts"]) {
		try {
			await db.execute(`SELECT * FROM ${table} LIMIT 1`);
			return {
				name: "fts5",
				category: "fts5",
				status: "ok",
				message: `FTS5 index (${table}) is accessible`,
			};
		} catch (err: unknown) {
			const msg = (err as Error).message ?? String(err);
			if (!msg.includes("no such table")) {
				return {
					name: "fts5",
					category: "fts5",
					status: "error",
					message: `FTS5 check failed: ${msg}`,
				};
			}
			// Table doesn't exist — try next table
		}
	}

	return {
		name: "fts5",
		category: "fts5",
		status: "warn",
		message: "FTS5 index not found (neither graph_nodes_fts nor entities_fts exists)",
	};
}

// ---------------------------------------------------------------------------
// checkOrphanEdges — count edges where from_id/to_id don't exist in graph_nodes
// ---------------------------------------------------------------------------

export async function checkOrphanEdges(db: SiaDb): Promise<DiagnosticCheck> {
	try {
		const { rows } = await db.execute(`
			SELECT COUNT(*) as count FROM graph_edges
			WHERE from_id NOT IN (SELECT id FROM graph_nodes)
			   OR to_id   NOT IN (SELECT id FROM graph_nodes)
		`);

		const count = (rows[0]?.count as number) ?? 0;

		if (count > 0) {
			return {
				name: "orphan_edges",
				category: "graph_integrity",
				status: "warn",
				message: `${count} edge(s) reference nonexistent graph_nodes`,
			};
		}

		return {
			name: "orphan_edges",
			category: "graph_integrity",
			status: "ok",
			message: "No orphan edges found",
		};
	} catch (err) {
		return {
			name: "orphan_edges",
			category: "graph_integrity",
			status: "error",
			message: `Failed to check: ${(err as Error).message}`,
		};
	}
}

// ---------------------------------------------------------------------------
// checkTemporalInvariants — count nodes where t_valid_from > t_valid_until
// ---------------------------------------------------------------------------

export async function checkTemporalInvariants(db: SiaDb): Promise<DiagnosticCheck> {
	try {
		const { rows } = await db.execute(`
			SELECT COUNT(*) as count FROM graph_nodes
			WHERE t_valid_from IS NOT NULL
			  AND t_valid_until IS NOT NULL
			  AND t_valid_from > t_valid_until
		`);

		const count = (rows[0]?.count as number) ?? 0;

		if (count > 0) {
			return {
				name: "temporal_invariants",
				category: "graph_integrity",
				status: "error",
				message: `${count} node(s) have t_valid_from > t_valid_until (temporal invariant violated)`,
			};
		}

		return {
			name: "temporal_invariants",
			category: "graph_integrity",
			status: "ok",
			message: "Temporal invariants are valid",
		};
	} catch (err) {
		return {
			name: "temporal_invariants",
			category: "graph_integrity",
			status: "error",
			message: `Failed to check: ${(err as Error).message}`,
		};
	}
}
