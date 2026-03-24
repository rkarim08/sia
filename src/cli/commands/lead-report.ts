// Module: lead-report — tech lead intelligence reports
//
// Usage:
//   sia lead-report --type drift|knowledge-map|compliance

import type { SiaDb } from "@/graph/db-interface";

const ACTIVE_FILTER = "t_valid_until IS NULL AND archived_at IS NULL";

// --- Drift Report ---

export interface DriftEntity {
	id: string;
	name: string;
	content: string;
	filePaths: string[];
	createdAt: string;
	trustTier: number;
}

export interface DriftReport {
	type: "drift";
	decisions: DriftEntity[];
	conventions: DriftEntity[];
}

async function generateDriftReport(db: SiaDb): Promise<DriftReport> {
	const decisions = await queryEntitiesByType(db, "Decision");
	const conventions = await queryEntitiesByType(db, "Convention");
	return { type: "drift", decisions, conventions };
}

// --- Knowledge Map Report ---

export interface KnowledgeMapReport {
	type: "knowledge-map";
	totalEntities: number;
	byType: Record<string, number>;
	byContributor: Record<string, number>;
}

async function generateKnowledgeMapReport(db: SiaDb): Promise<KnowledgeMapReport> {
	const { rows: totalRows } = await db.execute(
		`SELECT COUNT(*) AS cnt FROM graph_nodes WHERE ${ACTIVE_FILTER}`,
	);
	const totalEntities = (totalRows[0]?.cnt as number) ?? 0;

	const byType: Record<string, number> = {};
	const { rows: typeRows } = await db.execute(
		`SELECT type, COUNT(*) AS cnt FROM graph_nodes WHERE ${ACTIVE_FILTER} GROUP BY type`,
	);
	for (const row of typeRows) {
		byType[row.type as string] = row.cnt as number;
	}

	const byContributor: Record<string, number> = {};
	const { rows: contribRows } = await db.execute(
		`SELECT created_by, COUNT(*) AS cnt FROM graph_nodes WHERE ${ACTIVE_FILTER} GROUP BY created_by`,
	);
	for (const row of contribRows) {
		byContributor[row.created_by as string] = row.cnt as number;
	}

	return { type: "knowledge-map", totalEntities, byType, byContributor };
}

// --- Compliance Report ---

export interface ComplianceConvention {
	id: string;
	name: string;
	content: string;
	filePaths: string[];
}

export interface ComplianceReport {
	type: "compliance";
	conventions: ComplianceConvention[];
}

async function generateComplianceReport(db: SiaDb): Promise<ComplianceReport> {
	const entities = await queryEntitiesByType(db, "Convention");
	const conventions: ComplianceConvention[] = entities.map(({ id, name, content, filePaths }) => ({
		id, name, content, filePaths,
	}));
	return { type: "compliance", conventions };
}

// --- Shared ---

async function queryEntitiesByType(db: SiaDb, entityType: string): Promise<DriftEntity[]> {
	const { rows } = await db.execute(
		`SELECT id, name, content, file_paths, created_at, trust_tier
		 FROM graph_nodes
		 WHERE type = ? AND ${ACTIVE_FILTER}
		 ORDER BY created_at DESC`,
		[entityType],
	);
	return rows.map((row) => ({
		id: row.id as string,
		name: row.name as string,
		content: row.content as string,
		filePaths: parseJsonArray(row.file_paths as string),
		createdAt: new Date(row.created_at as number).toISOString(),
		trustTier: row.trust_tier as number,
	}));
}

function parseJsonArray(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

// --- Public API ---

export type LeadReport = DriftReport | KnowledgeMapReport | ComplianceReport;

export interface LeadReportOptions {
	type: "drift" | "knowledge-map" | "compliance";
}

export async function generateLeadReport(db: SiaDb, opts: LeadReportOptions): Promise<LeadReport> {
	switch (opts.type) {
		case "drift":
			return generateDriftReport(db);
		case "knowledge-map":
			return generateKnowledgeMapReport(db);
		case "compliance":
			return generateComplianceReport(db);
	}
}

export function formatLeadReport(report: LeadReport): string {
	switch (report.type) {
		case "drift":
			return formatDriftReport(report);
		case "knowledge-map":
			return formatKnowledgeMapReport(report);
		case "compliance":
			return formatComplianceReport(report);
	}
}

function formatDriftReport(report: DriftReport): string {
	const lines: string[] = [];
	lines.push("=== Architecture Drift Report ===");
	lines.push("");

	lines.push(`Decisions: ${report.decisions.length}`);
	for (const d of report.decisions) {
		lines.push(`  - ${d.name}`);
		if (d.filePaths.length > 0) {
			lines.push(`    Files: ${d.filePaths.join(", ")}`);
		}
	}

	lines.push("");
	lines.push(`Conventions: ${report.conventions.length}`);
	for (const c of report.conventions) {
		lines.push(`  - ${c.name}`);
		if (c.filePaths.length > 0) {
			lines.push(`    Files: ${c.filePaths.join(", ")}`);
		}
	}

	return lines.join("\n");
}

function formatKnowledgeMapReport(report: KnowledgeMapReport): string {
	const lines: string[] = [];
	lines.push("=== Knowledge Distribution Map ===");
	lines.push("");
	lines.push(`Total entities: ${report.totalEntities}`);

	lines.push("");
	lines.push("--- By Type ---");
	for (const [type, count] of Object.entries(report.byType).sort((a, b) => b[1] - a[1])) {
		lines.push(`  ${type.padEnd(20)} ${count}`);
	}

	lines.push("");
	lines.push("--- By Contributor ---");
	for (const [contrib, count] of Object.entries(report.byContributor).sort((a, b) => b[1] - a[1])) {
		lines.push(`  ${contrib.padEnd(20)} ${count}`);
	}

	return lines.join("\n");
}

function formatComplianceReport(report: ComplianceReport): string {
	const lines: string[] = [];
	lines.push("=== Convention Compliance ===");
	lines.push("");
	lines.push(`Conventions tracked: ${report.conventions.length}`);

	for (const c of report.conventions) {
		lines.push("");
		lines.push(`  ${c.name}`);
		if (c.filePaths.length > 0) {
			lines.push(`    Referenced files: ${c.filePaths.join(", ")}`);
		}
	}

	return lines.join("\n");
}

// --- CLI Entry Point ---

export async function runLeadReport(args: string[]): Promise<void> {
	const { resolveRepoHash } = await import("@/capture/hook");
	const { openGraphDb } = await import("@/graph/semantic-db");

	let type: LeadReportOptions["type"] = "drift";
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--type" && args[i + 1]) {
			const val = args[i + 1];
			if (val === "drift" || val === "knowledge-map" || val === "compliance") {
				type = val;
			} else {
				console.error(`Unknown report type: ${val}. Use: drift, knowledge-map, compliance`);
				return;
			}
		}
	}

	const repoHash = resolveRepoHash(process.cwd());
	const db = openGraphDb(repoHash);
	try {
		const report = await generateLeadReport(db, { type });
		console.log(formatLeadReport(report));
	} finally {
		await db.close();
	}
}
