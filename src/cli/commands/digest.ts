// Module: digest — Knowledge digest generator for graph activity summaries

import type { SiaDb } from "@/graph/db-interface";

export type DigestPeriod = "daily" | "weekly" | "monthly" | "custom";

export interface DigestOpts {
	period?: DigestPeriod;
	startDate?: number; // Unix ms
	endDate?: number; // Unix ms
}

export interface DigestSection {
	title: string;
	items: DigestItem[];
}

export interface DigestItem {
	id: string;
	name: string;
	type: string;
	summary: string;
	created_at: number;
}

export interface DigestResult {
	period: DigestPeriod;
	startDate: string;
	endDate: string;
	sections: DigestSection[];
	totalEntities: number;
}

/** Map entity type to human-readable section title. */
const TYPE_TITLES: Record<string, string> = {
	Decision: "Decisions Captured",
	Convention: "Conventions Established",
	Bug: "Bugs Identified",
	Solution: "Solutions Found",
	Concept: "Concepts Added",
	FileNode: "Files Indexed",
	ContentChunk: "Documentation Chunks",
};

/** Ordered list of types so sections appear in a stable order. */
const TYPE_ORDER: string[] = [
	"Decision",
	"Convention",
	"Bug",
	"Solution",
	"Concept",
	"FileNode",
	"ContentChunk",
];

const MS_PER_DAY = 86_400_000;

/**
 * Compute the start/end timestamps for a named period.
 * "custom" requires explicit startDate/endDate in opts.
 */
function resolveTimeRange(opts?: DigestOpts): {
	period: DigestPeriod;
	startDate: number;
	endDate: number;
} {
	const now = Date.now();
	const period = opts?.period ?? "weekly";
	const endDate = opts?.endDate ?? now;

	if (period === "custom") {
		if (opts?.startDate == null || opts?.endDate == null) {
			throw new Error("Custom period requires both startDate and endDate");
		}
		return { period, startDate: opts.startDate, endDate: opts.endDate };
	}

	let startDate: number;
	switch (period) {
		case "daily":
			startDate = endDate - MS_PER_DAY;
			break;
		case "monthly":
			startDate = endDate - 30 * MS_PER_DAY;
			break;
		default:
			startDate = endDate - 7 * MS_PER_DAY;
			break;
	}

	return { period, startDate, endDate };
}

/**
 * Generate a knowledge digest for the specified time period.
 * Queries the graph for entities created within the period, grouped by type.
 */
export async function generateDigest(db: SiaDb, opts?: DigestOpts): Promise<DigestResult> {
	const { period, startDate, endDate } = resolveTimeRange(opts);

	const { rows } = await db.execute(
		`SELECT id, type, name, summary, created_at FROM graph_nodes
		 WHERE created_at >= ? AND created_at <= ?
		   AND t_valid_until IS NULL AND archived_at IS NULL
		 ORDER BY type, importance DESC`,
		[startDate, endDate],
	);

	// Group rows by type
	const grouped = new Map<string, DigestItem[]>();
	for (const row of rows) {
		const type = row.type as string;
		const item: DigestItem = {
			id: row.id as string,
			name: row.name as string,
			type,
			summary: row.summary as string,
			created_at: row.created_at as number,
		};
		const list = grouped.get(type);
		if (list) {
			list.push(item);
		} else {
			grouped.set(type, [item]);
		}
	}

	// Build sections in stable order, only including non-empty ones
	const sections: DigestSection[] = [];
	for (const type of TYPE_ORDER) {
		const items = grouped.get(type);
		if (items && items.length > 0) {
			sections.push({
				title: TYPE_TITLES[type] ?? type,
				items,
			});
		}
	}

	// Include any types not in TYPE_ORDER (future entity types)
	for (const [type, items] of grouped) {
		if (!TYPE_ORDER.includes(type) && items.length > 0) {
			sections.push({
				title: TYPE_TITLES[type] ?? type,
				items,
			});
		}
	}

	const totalEntities = rows.length;

	return {
		period,
		startDate: new Date(startDate).toISOString(),
		endDate: new Date(endDate).toISOString(),
		sections,
		totalEntities,
	};
}

/**
 * Render a digest as markdown text.
 */
export function renderDigestMarkdown(digest: DigestResult): string {
	const lines: string[] = [];

	lines.push(`# Knowledge Digest — ${digest.period}`);
	lines.push("");
	lines.push(`**Period:** ${digest.startDate.slice(0, 10)} to ${digest.endDate.slice(0, 10)}`);
	lines.push("");
	lines.push(`**Total new entities:** ${digest.totalEntities}`);

	for (const section of digest.sections) {
		const items = section.items.slice(0, 10);
		lines.push("");
		lines.push(`## ${section.title} (${section.items.length})`);
		lines.push("");
		lines.push("| Name | Summary |");
		lines.push("|------|---------|");
		for (const item of items) {
			// Escape pipes in name/summary to avoid breaking the table
			const name = item.name.replace(/\|/g, "\\|");
			const summary = item.summary.replace(/\|/g, "\\|");
			lines.push(`| ${name} | ${summary} |`);
		}
	}

	lines.push("");
	return lines.join("\n");
}
