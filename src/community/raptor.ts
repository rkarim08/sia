// Module: raptor — RAPTOR summary tree construction

import { createHash } from "node:crypto";
import type { SiaDb } from "@/graph/db-interface";
import type { LlmClient } from "@/shared/llm-client";

interface EntityRow {
	id: string;
	content: string;
	summary: string;
	t_valid_until: number | null;
}

interface CommunityRow {
	id: string;
	summary: string | null;
}

interface SummaryRow {
	id: string;
	level: number;
	scopeId: string;
	content: string;
	tokenCount: number;
	contentHash: string;
	expiresAt: number | null;
}

function wordCount(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return trimmed.split(/\s+/).length;
}

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

async function upsertSummary(db: SiaDb, row: SummaryRow, now: number): Promise<void> {
	await db.execute(
		`INSERT INTO summary_tree (id, level, scope_id, content, content_hash, token_count, created_at, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                        level = excluded.level,
                        scope_id = excluded.scope_id,
                        content = excluded.content,
                        content_hash = excluded.content_hash,
                        token_count = excluded.token_count,
                        created_at = excluded.created_at,
                        expires_at = excluded.expires_at`,
		[
			row.id,
			row.level,
			row.scopeId,
			row.content,
			row.contentHash,
			row.tokenCount,
			now,
			row.expiresAt,
		],
	);
}

export async function buildSummaryTree(db: SiaDb, llmClient?: LlmClient): Promise<void> {
	const now = Date.now();

	const entityResult = await db.execute(
		`SELECT id, content, summary, t_valid_until
		 FROM entities
		 WHERE t_valid_until IS NULL AND archived_at IS NULL`,
	);
	const communityResult = await db.execute(`SELECT id, summary FROM communities`);

	const entities = entityResult.rows as unknown as EntityRow[];
	const communities = communityResult.rows as unknown as CommunityRow[];

	await db.transaction(async (tx) => {
		// Level 0 — raw entity content (eager)
		for (const entity of entities) {
			const level0: SummaryRow = {
				id: `lvl0:${entity.id}`,
				level: 0,
				scopeId: entity.id,
				content: entity.content,
				tokenCount: wordCount(entity.content),
				contentHash: hashContent(entity.content),
				expiresAt: null,
			};
			await upsertSummary(tx, level0, now);
		}

		// Level 1 — lazy (generated on-demand via getOrCreateLevel1Summary)

		// Level 2 — community/module summaries via LLM
		for (const community of communities) {
			let content: string;
			if (llmClient && community.summary?.trim()) {
				content = await llmClient.summarize(
					`Rewrite this community summary as a coherent paragraph describing the module's purpose:\n\n${community.summary}`,
				);
			} else {
				content = community.summary?.trim()
					? community.summary
					: `Community ${community.id} has no summary.`;
			}
			const level2: SummaryRow = {
				id: `lvl2:${community.id}`,
				level: 2,
				scopeId: community.id,
				content,
				tokenCount: wordCount(content),
				contentHash: hashContent(content),
				expiresAt: null,
			};
			await upsertSummary(tx, level2, now);
		}

		// Level 3 — architectural overview (only regenerate weekly)
		if (communities.length > 0) {
			const existingLevel3 = await tx.execute(
				"SELECT created_at FROM summary_tree WHERE id = 'lvl3:overview'",
			);
			const lastLevel3At = (existingLevel3.rows[0]?.created_at as number) ?? 0;
			const oneWeek = 7 * 24 * 60 * 60 * 1000;
			if (now - lastLevel3At < oneWeek && existingLevel3.rows.length > 0) {
				// Skip Level 3 regeneration — generated less than 7 days ago
			} else {
				const overviewBody = communities
					.map((c) => {
						const text =
							c.summary && c.summary.trim().length > 0
								? c.summary.trim()
								: `Community ${c.id} has no summary.`;
						return `- ${text}`;
					})
					.join("\n");
				const overview = `Architectural overview:\n${overviewBody}`;
				const level3: SummaryRow = {
					id: "lvl3:overview",
					level: 3,
					scopeId: "all",
					content: overview,
					tokenCount: wordCount(overview),
					contentHash: hashContent(overview),
					expiresAt: null,
				};
				await upsertSummary(tx, level3, now);
			}
		}
	});
}

/**
 * Lazily get or create a Level 1 summary for a single entity.
 * Returns the summary text, or null if the entity does not exist.
 */
export async function getOrCreateLevel1Summary(
	db: SiaDb,
	entityId: string,
	llmClient?: LlmClient,
): Promise<string | null> {
	// Check if Level 1 summary already exists and is not expired
	const existing = await db.execute(
		"SELECT content FROM summary_tree WHERE id = ? AND expires_at IS NULL",
		[`lvl1:${entityId}`],
	);
	if (existing.rows.length > 0) {
		return existing.rows[0].content as string;
	}

	// Fetch entity
	const entityResult = await db.execute(
		"SELECT id, content, summary, t_valid_until FROM entities WHERE id = ?",
		[entityId],
	);
	if (entityResult.rows.length === 0) return null;
	const entity = entityResult.rows[0] as {
		id: string;
		content: string;
		summary: string;
		t_valid_until: number | null;
	};

	// Generate via LLM or fallback
	let summaryText: string;
	if (llmClient) {
		summaryText = await llmClient.summarize(
			`Write a one-paragraph summary of this code entity:\n\nName: ${entity.id}\nContent: ${entity.content.slice(0, 500)}`,
		);
	} else {
		summaryText = entity.summary?.trim() ? entity.summary : entity.content.slice(0, 240);
	}

	const now = Date.now();
	await upsertSummary(
		db,
		{
			id: `lvl1:${entityId}`,
			level: 1,
			scopeId: entityId,
			content: summaryText,
			tokenCount: wordCount(summaryText),
			contentHash: hashContent(summaryText),
			expiresAt: entity.t_valid_until ? now : null,
		},
		now,
	);

	return summaryText;
}
