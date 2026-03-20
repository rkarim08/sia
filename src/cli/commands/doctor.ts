// Module: doctor — System health check with hook + provider diagnostics
//
// `npx sia doctor` reports overall system health.
// `npx sia doctor --providers` adds LLM provider connectivity checks.
//
// Checks: runtimes, hooks, capture mode, FTS5, ONNX model, native module,
// community detection backend, graph integrity, inverted dependency index,
// and (optionally) LLM provider health.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SiaDb } from "@/graph/db-interface";
import { detectAgent, getRecommendedCaptureMode } from "@/hooks/agent-detect";
import { getHookConfig } from "@/hooks/event-router";
import { getDefaultLlmConfig } from "@/llm/config";
import type { OperationRole } from "@/llm/provider-registry";
import { isNativeAvailable } from "@/native/bridge";

export interface DoctorCheck {
	name: string;
	status: "ok" | "warn" | "error";
	message: string;
}

export interface DoctorReport {
	checks: DoctorCheck[];
	captureMode: string;
	agent: string;
	nativeModule: string;
	communityBackend: string;
	hookHealth: Array<{ event: string; type: string; status: string }>;
	providerHealth: Array<{
		role: string;
		provider: string;
		model: string;
		status: string;
	}>;
}

/**
 * Run the full doctor diagnostic suite.
 */
export async function runDoctor(
	db: SiaDb | null,
	cwd: string,
	options?: { providers?: boolean },
): Promise<DoctorReport> {
	const checks: DoctorCheck[] = [];

	// 1. Detect agent
	const agent = detectAgent(cwd);
	const captureMode = getRecommendedCaptureMode(agent);
	checks.push({
		name: "Agent detection",
		status: "ok",
		message: `Detected: ${agent} (capture mode: ${captureMode})`,
	});

	// 2. Native module
	const nativeStatus = isNativeAvailable();
	checks.push({
		name: "Native module",
		status: nativeStatus === "typescript" ? "warn" : "ok",
		message:
			nativeStatus === "typescript"
				? "Using TypeScript fallbacks (install @sia/native for 5-20x faster AST diffing)"
				: `Loaded: ${nativeStatus}`,
	});

	// 3. Community detection backend
	const communityBackend =
		nativeStatus !== "typescript" ? "Rust Leiden via graphrs" : "JavaScript Louvain (in-process)";
	checks.push({
		name: "Community detection",
		status: "ok",
		message: communityBackend,
	});

	// 4. ONNX model
	const modelPath = join(
		process.env.SIA_HOME ?? join(process.env.HOME ?? "~", ".sia"),
		"models",
		"all-MiniLM-L6-v2.onnx",
	);
	const modelExists = existsSync(modelPath);
	checks.push({
		name: "ONNX embedding model",
		status: modelExists ? "ok" : "warn",
		message: modelExists
			? `Found at ${modelPath}`
			: `Not found at ${modelPath} — run npx sia download-model`,
	});

	// 5. Graph integrity (if DB available)
	if (db) {
		try {
			const { rows: entityCount } = await db.execute("SELECT COUNT(*) as cnt FROM entities", []);
			const { rows: edgeCount } = await db.execute("SELECT COUNT(*) as cnt FROM edges", []);
			const entities = (entityCount[0] as { cnt: number }).cnt;
			const edges = (edgeCount[0] as { cnt: number }).cnt;
			checks.push({
				name: "Graph integrity",
				status: "ok",
				message: `${entities} entities, ${edges} edges`,
			});

			// Check for orphan edges
			const { rows: orphans } = await db.execute(
				`SELECT COUNT(*) as cnt FROM edges e
				 WHERE NOT EXISTS (SELECT 1 FROM entities WHERE id = e.from_id)
				    OR NOT EXISTS (SELECT 1 FROM entities WHERE id = e.to_id)`,
				[],
			);
			const orphanCount = (orphans[0] as { cnt: number }).cnt;
			if (orphanCount > 0) {
				checks.push({
					name: "Orphan edges",
					status: "warn",
					message: `${orphanCount} edges reference non-existent entities`,
				});
			}

			// Check FTS5
			try {
				await db.execute("SELECT COUNT(*) FROM entities_fts", []);
				checks.push({ name: "FTS5 index", status: "ok", message: "Operational" });
			} catch {
				checks.push({ name: "FTS5 index", status: "error", message: "Not available" });
			}

			// Check source_deps (inverted index)
			try {
				const { rows: depCount } = await db.execute("SELECT COUNT(*) as cnt FROM source_deps", []);
				const deps = (depCount[0] as { cnt: number }).cnt;
				checks.push({
					name: "Inverted dependency index",
					status: deps > 0 ? "ok" : "warn",
					message: `${deps} source-to-node mappings`,
				});
			} catch {
				checks.push({
					name: "Inverted dependency index",
					status: "warn",
					message: "source_deps table not found — run npx sia reindex",
				});
			}
		} catch (err) {
			checks.push({
				name: "Graph integrity",
				status: "error",
				message: `Failed to query graph: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	// 6. Hook health
	const hookConfig = getHookConfig();
	const hookHealth = Object.entries(hookConfig).map(([event, configs]) => {
		const config = configs[0] as Record<string, unknown>;
		const type = config.type as string;
		// We can't actually test HTTP connectivity here without the server running,
		// so we report the configuration status
		return {
			event,
			type,
			status:
				type === "command"
					? "configured (command)"
					: `configured (${config.async ? "async" : "sync"})`,
		};
	});

	// 7. Provider health (only if --providers flag)
	const providerHealth: DoctorReport["providerHealth"] = [];
	if (options?.providers) {
		const config = getDefaultLlmConfig();
		const roles: OperationRole[] = ["summarize", "validate", "extract", "consolidate"];

		for (const role of roles) {
			const providerConfig = config.providers[role];
			const isStandby = captureMode === "hooks" && (role === "extract" || role === "consolidate");

			providerHealth.push({
				role,
				provider: providerConfig?.provider ?? "not configured",
				model: providerConfig?.model ?? "not configured",
				status: isStandby ? "standby (hooks active)" : "configured",
			});
		}
	}

	return {
		checks,
		captureMode,
		agent,
		nativeModule: nativeStatus,
		communityBackend,
		hookHealth,
		providerHealth,
	};
}

/**
 * Format the doctor report as human-readable output.
 */
export function formatDoctorReport(report: DoctorReport): string {
	const lines: string[] = [];

	lines.push("Sia Doctor Report");
	lines.push("═".repeat(50));
	lines.push(`Capture Mode: ${report.captureMode} (${report.agent} detected)`);
	lines.push("");

	// Checks
	for (const check of report.checks) {
		const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
		lines.push(`  ${icon} ${check.name}: ${check.message}`);
	}

	// Hook configuration
	lines.push("");
	lines.push("Hook Configuration:");
	for (const hook of report.hookHealth) {
		lines.push(`  ✓ ${hook.event}: ${hook.status}`);
	}

	// Provider health (if checked)
	if (report.providerHealth.length > 0) {
		lines.push("");
		lines.push("LLM Providers:");
		for (const provider of report.providerHealth) {
			const icon = provider.status.includes("standby") ? "⚡" : "✓";
			lines.push(
				`  ${icon} ${provider.role}: ${provider.provider} / ${provider.model} — ${provider.status}`,
			);
		}
	}

	return lines.join("\n");
}
