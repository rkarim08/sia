// Module: freshness — CLI freshness report command

import type { SiaDb } from "@/graph/db-interface";
import { getNativeModuleStatus } from "@/native/bridge";

export interface FreshnessReport {
	totalNodes: number;
	freshNodes: number;
	staleNodes: number;
	rottenNodes: number;
	pendingRevalidation: number;
	avgConfidenceByTier: Record<string, number>;
	lastDeepValidation: number | null;
	indexCoverage: number; // percentage of nodes with source mappings
	nativeModuleStatus: string; // "native" | "wasm" | "typescript"
}

// Confidence thresholds for freshness classification
const FRESH_THRESHOLD = 0.7;
const ROTTEN_THRESHOLD = 0.3;

/**
 * Generate a freshness report for the graph.
 */
export async function generateFreshnessReport(db: SiaDb): Promise<FreshnessReport> {
	// 1. Total node count
	const { rows: totalRows } = await db.execute("SELECT COUNT(*) AS cnt FROM entities");
	const totalNodes = (totalRows[0]?.cnt as number) ?? 0;

	// 2. Active node count (not archived, not invalidated)
	const { rows: activeRows } = await db.execute(
		"SELECT COUNT(*) AS cnt FROM entities WHERE archived_at IS NULL AND t_valid_until IS NULL",
	);
	const activeNodes = (activeRows[0]?.cnt as number) ?? 0;

	// 3. Fresh nodes: confidence > FRESH_THRESHOLD (active only)
	const { rows: freshRows } = await db.execute(
		"SELECT COUNT(*) AS cnt FROM entities WHERE archived_at IS NULL AND t_valid_until IS NULL AND confidence > ?",
		[FRESH_THRESHOLD],
	);
	const freshNodes = (freshRows[0]?.cnt as number) ?? 0;

	// 4. Rotten nodes: confidence < ROTTEN_THRESHOLD (active only)
	const { rows: rottenRows } = await db.execute(
		"SELECT COUNT(*) AS cnt FROM entities WHERE archived_at IS NULL AND t_valid_until IS NULL AND confidence < ?",
		[ROTTEN_THRESHOLD],
	);
	const rottenNodes = (rottenRows[0]?.cnt as number) ?? 0;

	// 5. Stale nodes: between thresholds
	const staleNodes = activeNodes - freshNodes - rottenNodes;

	// 6. Pending revalidation: invalidated but not yet replaced
	const { rows: pendingRows } = await db.execute(
		"SELECT COUNT(*) AS cnt FROM entities WHERE t_valid_until IS NOT NULL AND archived_at IS NULL",
	);
	const pendingRevalidation = (pendingRows[0]?.cnt as number) ?? 0;

	// 7. Average confidence by trust tier
	const { rows: tierRows } = await db.execute(
		"SELECT trust_tier, AVG(confidence) AS avg_conf FROM entities WHERE archived_at IS NULL AND t_valid_until IS NULL GROUP BY trust_tier",
	);
	const avgConfidenceByTier: Record<string, number> = {};
	for (const row of tierRows) {
		const tier = String(row.trust_tier as number);
		avgConfidenceByTier[tier] = Math.round((row.avg_conf as number) * 100) / 100;
	}

	// 8. Index coverage: percentage of active nodes with at least one source mapping
	let indexCoverage = 0;
	if (totalNodes > 0) {
		const { rows: mappedRows } = await db.execute(
			"SELECT COUNT(DISTINCT node_id) AS cnt FROM source_deps",
		);
		const mappedNodes = (mappedRows[0]?.cnt as number) ?? 0;
		indexCoverage = Math.round((mappedNodes / totalNodes) * 100 * 10) / 10;
	}

	// 9. Last deep validation: not persisted in DB yet — return null
	const lastDeepValidation: number | null = null;

	// 10. Native module status
	const nativeModuleStatus = getNativeModuleStatus();

	return {
		totalNodes,
		freshNodes,
		staleNodes,
		rottenNodes,
		pendingRevalidation,
		avgConfidenceByTier,
		lastDeepValidation,
		indexCoverage,
		nativeModuleStatus,
	};
}

/**
 * Format the report as human-readable output for CLI.
 */
export function formatFreshnessReport(report: FreshnessReport): string {
	const lines: string[] = [];

	const sep = "──────────────────────────────";

	lines.push("Sia Graph Freshness Report");
	lines.push(sep);

	// Node counts
	const total = report.totalNodes;
	const freshPct = total > 0 ? ((report.freshNodes / total) * 100).toFixed(1) : "0.0";
	const stalePct = total > 0 ? ((report.staleNodes / total) * 100).toFixed(1) : "0.0";
	const rottenPct = total > 0 ? ((report.rottenNodes / total) * 100).toFixed(1) : "0.0";

	lines.push(`Total nodes:          ${formatNumber(total)}`);
	lines.push(`  Fresh:              ${formatNumber(report.freshNodes)} (${freshPct}%)`);
	lines.push(`  Stale:              ${formatNumber(report.staleNodes)} (${stalePct}%)`);
	lines.push(`  Rotten:             ${formatNumber(report.rottenNodes)} (${rottenPct}%)`);
	lines.push("");

	// Confidence by trust tier
	const tierNames: Record<string, string> = {
		"1": "Tier 1 (User)",
		"2": "Tier 2 (AST)",
		"3": "Tier 3 (LLM)",
		"4": "Tier 4 (External)",
	};

	const tierKeys = Object.keys(report.avgConfidenceByTier).sort();
	if (tierKeys.length > 0) {
		lines.push("Confidence by Trust Tier:");
		for (const tier of tierKeys) {
			const name = tierNames[tier] ?? `Tier ${tier}`;
			const conf = report.avgConfidenceByTier[tier]?.toFixed(2) ?? "N/A";
			lines.push(`  ${name.padEnd(22)} ${conf}`);
		}
		lines.push("");
	}

	// Index coverage
	lines.push(
		`Index Coverage:        ${report.indexCoverage.toFixed(1)}% (nodes with source mappings)`,
	);

	// Native module
	lines.push(`Native Module:         ${report.nativeModuleStatus}`);

	// Last deep validation
	const lastVal =
		report.lastDeepValidation !== null
			? new Date(report.lastDeepValidation).toISOString().replace("T", " ").slice(0, 19)
			: "never";
	lines.push(`Last Deep Validation:  ${lastVal}`);

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
	return n.toLocaleString("en-US");
}
